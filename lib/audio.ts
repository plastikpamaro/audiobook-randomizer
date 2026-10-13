import "server-only";

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { AppError } from "@/lib/app-error";
import { uuidSchema } from "@/lib/validation";

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
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  // RFC 9110: Range is only processed on GET, never on HEAD.
  const rangeHeader = request.method === "GET" ? request.headers.get("range") : null;
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
