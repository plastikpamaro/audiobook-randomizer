import "server-only";

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { AppError } from "@/lib/app-error";
import { uuidSchema } from "@/lib/validation";

const validators = new Map<string, { fingerprint: string; etag: Promise<string> }>();

async function audioEtag(path: string, info: { size: number; ino: number; mtimeMs: number; ctimeMs: number }): Promise<string> {
  const fingerprint = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const existing = validators.get(path);
  if (existing?.fingerprint === fingerprint) return existing.etag;
  // A content hash is a strong validator, so cached byte ranges can be reused
  // together. Hash once per file version, not on each seek or HEAD request.
  const entry = { fingerprint, etag: (async () => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return `"${hash.digest("hex")}"`;
  })() };
  if (validators.size >= 128) validators.delete(validators.keys().next().value!);
  validators.set(path, entry);
  try { return await entry.etag; } catch (error) {
    if (validators.get(path) === entry) validators.delete(path);
    throw error;
  }
}

export function audioDirectory(): string {
  // Audio is mounted at runtime and must never be bundled in the application.
  return resolve(/* turbopackIgnore: true */ process.env.AUDIO_STORAGE_PATH?.trim() || "data/audio");
}

export function audioPath(episodeId: string): string {
  return join(audioDirectory(), `${uuidSchema.parse(episodeId)}.mp3`);
}

export async function getAudioEpisodeIds(): Promise<Set<string>> {
  try {
    const entries = await readdir(/* turbopackIgnore: true */ audioDirectory(), { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".mp3"))
      .map((entry) => entry.name.slice(0, -4)).filter((id) => uuidSchema.safeParse(id).success));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

export async function getEpisodeAudioUrl(episodeId: string): Promise<string | null> {
  try {
    const info = await stat(audioPath(episodeId));
    return info.isFile() && info.size > 0 ? `/api/episodes/${episodeId}/audio` : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// A single byte range lets the browser seek without downloading the whole MP3.
export function parseAudioRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function audioResponse(request: Request, episodeId: string): Promise<Response> {
  const path = audioPath(episodeId);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new AppError("Für diese Folge ist keine Originalfassung hinterlegt.", 404, "AUDIO_NOT_FOUND");
    throw error;
  });
  if (!info.isFile() || info.size === 0) throw new AppError("Audiodatei nicht gefunden.", 404, "AUDIO_NOT_FOUND");
  const etag = await audioEtag(path, info);
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "Vary": "Cookie",
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
  });
  // Authentication has already run in the route, even for revalidation.
  const matches = request.headers.get("if-none-match")?.split(",").some((value) => {
    const candidate = value.trim().replace(/^W\//, "");
    return candidate === "*" || candidate === etag;
  });
  if (matches) return new Response(null, { status: 304, headers });
  // RFC 9110: Range is only processed on GET, never on HEAD.
  // An outdated If-Range must receive the whole new file, never mismatched chunks.
  const ifRange = request.headers.get("if-range");
  const rangeHeader = request.method === "GET" && (!ifRange || ifRange === etag) ? request.headers.get("range") : null;
  const range = rangeHeader ? parseAudioRange(rangeHeader, info.size) : null;
  if (rangeHeader && !range) {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  if (request.method === "HEAD") return new Response(null, { headers });
  const stream = createReadStream(path, { start, end, signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
