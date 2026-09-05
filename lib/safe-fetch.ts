import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "@/lib/app-error";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsed as ipaddr.IPv6).toIPv4Address().range() === "unicast";
  }
  return parsed.range() === "unicast";
}

async function resolvePublicHttpsUrl(value: string): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("Die Quellen-URL ist ungültig."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new AppError("Quellen müssen öffentliche HTTPS-URLs ohne Zugangsdaten verwenden.", 422, "UNSAFE_SOURCE_URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    throw new AppError("Lokale und Metadaten-Adressen sind als Quelle gesperrt.", 422, "UNSAFE_SOURCE_URL");
  }
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
    throw new AppError("Die Quelle löst auf eine nicht öffentliche Adresse auf.", 422, "UNSAFE_SOURCE_URL");
  }
  return { url, addresses };
}

export async function assertPublicHttpsUrl(value: string): Promise<URL> {
  return (await resolvePublicHttpsUrl(value)).url;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
}

export async function safeFetchText(
  initialUrl: string,
  validators?: { etag?: string | null; lastModified?: string | null },
): Promise<SafeFetchResult> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const { url, addresses } = await resolvePublicHttpsUrl(current);
    const pinned = addresses.find((address) => address.family === 4) || addresses[0];
    const agent = new Agent({
      connect: {
        lookup(_hostname, options, callback) {
          if (options.all) callback(null, addresses);
          else callback(null, pinned.address, pinned.family);
        },
      },
    });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        redirect: "manual",
        signal,
        headers: {
          Accept: "text/html, application/json, application/rss+xml, application/xml, text/csv, text/plain;q=0.8",
          "User-Agent": "Hoerspielbeutel/2.0 (+self-hosted catalog synchronizer)",
          ...(validators?.etag ? { "If-None-Match": validators.etag } : {}),
          ...(validators?.lastModified ? { "If-Modified-Since": validators.lastModified } : {}),
        },
        dispatcher: agent,
      });
    } catch (error) {
      await agent.close().catch(() => undefined);
      if (isTimeout(error)) throw new AppError("Abruf nach 15 Sekunden abgebrochen.", 504, "IMPORT_TIMEOUT");
      throw new AppError("Quelle konnte nicht abgerufen werden.", 502, "IMPORT_FETCH_FAILED");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      await agent.close();
      if (!location) throw new AppError("Die Quelle liefert eine Weiterleitung ohne Ziel.", 502, "IMPORT_REDIRECT");
      if (redirect === MAX_REDIRECTS) throw new AppError("Die Quelle leitet zu oft weiter.", 502, "IMPORT_REDIRECT_LIMIT");
      current = new URL(location, url).href;
      validators = undefined;
      continue;
    }
    if (response.status === 304) {
      await response.body?.cancel();
      await agent.close();
      return { url: url.href, status: 304, body: null, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), contentType: response.headers.get("content-type") };
    }
    if (!response.ok) {
      await response.body?.cancel();
      await agent.close();
      throw new AppError(`Quelle antwortet mit HTTP ${response.status}.`, 502, "IMPORT_HTTP_ERROR");
    }
    const announcedSize = Number(response.headers.get("content-length") || 0);
    if (announcedSize > MAX_BYTES) {
      await response.body?.cancel();
      await agent.close();
      throw new AppError("Die Quelle ist größer als 5 MB.", 413, "IMPORT_TOO_LARGE");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw new AppError("Die Quelle ist größer als 5 MB.", 413, "IMPORT_TOO_LARGE");
          }
          chunks.push(chunk.value);
        }
      }
    } catch (error) {
      if (isTimeout(error)) throw new AppError("Abruf nach 15 Sekunden abgebrochen.", 504, "IMPORT_TIMEOUT");
      throw error;
    } finally {
      await agent.close();
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: url.href, status: response.status, body, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), contentType: response.headers.get("content-type") };
  }
  throw new AppError("Die Quelle leitet zu oft weiter.", 502, "IMPORT_REDIRECT_LIMIT");
}
