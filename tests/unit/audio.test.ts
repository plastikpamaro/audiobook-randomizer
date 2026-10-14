import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApiUser: vi.fn() }));

import { audioPath, audioResponse, getAudioEpisodeIds, getEpisodeAudioUrl, parseAudioRange } from "@/lib/audio";
import { requireApiUser } from "@/lib/auth";
import { GET } from "@/app/api/episodes/[id]/audio/route";
import { AppError } from "@/lib/app-error";

const episodeId = "d0e9df18-3c25-42b6-819e-6cf7a180ddd1";

describe("private Originalfassungen", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "audiobook-audio-"));
    vi.stubEnv("AUDIO_STORAGE_PATH", directory);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("erkennt nur Dateien mit Folgen-UUID und verhindert Pfadzugriffe", async () => {
    await writeFile(join(directory, `${episodeId}.mp3`), "0123456789");
    await writeFile(join(directory, "other.mp3"), "irrelevant");
    expect(await getAudioEpisodeIds()).toEqual(new Set([episodeId]));
    expect(await getEpisodeAudioUrl(episodeId)).toBe(`/api/episodes/${episodeId}/audio`);
    expect(() => audioPath("../../secret")).toThrow();
  });

  it("liefert vollständige Dateien, Teilbereiche und HEAD korrekt", async () => {
    await writeFile(audioPath(episodeId), "0123456789");
    const full = await audioResponse(new Request("http://localhost/audio"), episodeId);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("cache-control")).toBe("private, no-cache");
    expect(full.headers.get("vary")).toBe("Cookie");
    expect(full.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await full.text()).toBe("0123456789");
    const partial = await audioResponse(new Request("http://localhost/audio", { headers: { range: "bytes=2-5" } }), episodeId);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(partial.headers.get("content-length")).toBe("4");
    expect(await partial.text()).toBe("2345");
    const head = await audioResponse(new Request("http://localhost/audio", { method: "HEAD", headers: { range: "bytes=2-5" } }), episodeId);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
  });

  it("meldet fehlende Dateien und nicht erfüllbare Bereiche", async () => {
    expect(await getEpisodeAudioUrl(episodeId)).toBeNull();
    await expect(audioResponse(new Request("http://localhost/audio"), episodeId)).rejects.toMatchObject({ status: 404 });
    await writeFile(audioPath(episodeId), "0123456789");
    const response = await audioResponse(new Request("http://localhost/audio", { headers: { range: "bytes=10-" } }), episodeId);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("bestätigt unveränderte Audiodaten ohne erneuten Download", async () => {
    await writeFile(audioPath(episodeId), "0123456789");
    const first = await audioResponse(new Request("http://localhost/audio", { method: "HEAD" }), episodeId);
    const tag = first.headers.get("etag")!;
    for (const method of ["GET", "HEAD"]) {
      const cached = await audioResponse(new Request("http://localhost/audio", { method, headers: { "if-none-match": `"other", W/${tag}`, range: "bytes=2-5" } }), episodeId);
      expect(cached.status).toBe(304);
      expect(await cached.text()).toBe("");
      expect(cached.headers.get("etag")).toBe(tag);
      expect(cached.headers.get("cache-control")).toBe("private, no-cache");
      expect(cached.headers.get("content-length")).toBeNull();
    }
  });

  it("erkennt ersetzte Dateien gleicher Größe und mischt keine alten Bytebereiche", async () => {
    const path = audioPath(episodeId);
    await writeFile(path, "0123456789");
    const first = await audioResponse(new Request("http://localhost/audio", { method: "HEAD" }), episodeId);
    const tag = first.headers.get("etag")!;
    const valid = await audioResponse(new Request("http://localhost/audio", { headers: { range: "bytes=2-5", "if-range": tag } }), episodeId);
    expect(valid.status).toBe(206);
    expect(await valid.text()).toBe("2345");
    await writeFile(path, "abcdefghij");
    await utimes(path, new Date("2030-01-01"), new Date("2030-01-01"));
    const changed = await audioResponse(new Request("http://localhost/audio", { headers: { "if-none-match": tag } }), episodeId);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(tag);
    expect(await changed.text()).toBe("abcdefghij");
    const outdated = await audioResponse(new Request("http://localhost/audio", { headers: { range: "bytes=2-5", "if-range": tag } }), episodeId);
    expect(outdated.status).toBe(200);
    expect(outdated.headers.get("content-range")).toBeNull();
    expect(await outdated.text()).toBe("abcdefghij");
  });

  it("erfordert auch für eine Cache-Bestätigung eine Anmeldung", async () => {
    await writeFile(audioPath(episodeId), "0123456789");
    const first = await audioResponse(new Request("http://localhost/audio", { method: "HEAD" }), episodeId);
    vi.mocked(requireApiUser).mockRejectedValueOnce(new AppError("Bitte anmelden", 401, "UNAUTHENTICATED"));
    const blocked = await GET(new Request("http://localhost/audio", { headers: { "if-none-match": first.headers.get("etag")! } }), { params: Promise.resolve({ id: episodeId }) });
    expect(blocked.status).toBe(401);
    expect(blocked.headers.get("cache-control")).toBe("private, no-store");
  });

  it("schützt auch Teilbereichsabrufe durch die Anmeldung", async () => {
    await writeFile(audioPath(episodeId), "0123456789");
    const context = { params: Promise.resolve({ id: episodeId }) };
    vi.mocked(requireApiUser).mockRejectedValueOnce(new AppError("Bitte melde dich an.", 401, "UNAUTHENTICATED"));
    const blocked = await GET(new Request("http://localhost/audio", { headers: { range: "bytes=0-3" } }), context);
    expect(blocked.status).toBe(401);
    vi.mocked(requireApiUser).mockResolvedValueOnce({ id: "test-user", email: "test@example.com", role: "owner" });
    const allowed = await GET(new Request("http://localhost/audio", { headers: { range: "bytes=0-3" } }), context);
    expect(allowed.status).toBe(206);
    expect(await allowed.text()).toBe("0123");
  });

  it("unterstützt offene Bereiche und Suffixe, begrenzt Endpositionen", () => {
    expect(parseAudioRange("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
    expect(parseAudioRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseAudioRange("bytes=-20", 10)).toEqual({ start: 0, end: 9 });
    expect(parseAudioRange("bytes=0-100", 10)).toEqual({ start: 0, end: 9 });
    for (const range of ["bytes=-", "bytes=-0", "bytes=6-4", "bytes=0-1,3-4", "items=0-1", "bytes=9007199254740992-"]) {
      expect(parseAudioRange(range, 10)).toBeNull();
    }
  });
});
