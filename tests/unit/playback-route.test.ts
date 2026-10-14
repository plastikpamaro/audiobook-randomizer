import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApiUser: vi.fn() }));
vi.mock("@/lib/audio", () => ({ getEpisodeAudioUrl: vi.fn() }));
vi.mock("@/lib/playback", () => ({ claimPlayback: vi.fn(), getPlaybackProgress: vi.fn(), savePlaybackProgress: vi.fn() }));

import { GET, POST, PUT } from "@/app/api/episodes/[id]/playback/route";
import { requireApiUser } from "@/lib/auth";
import { getEpisodeAudioUrl } from "@/lib/audio";
import { AppError } from "@/lib/app-error";
import { claimPlayback, getPlaybackProgress, savePlaybackProgress } from "@/lib/playback";

const id = "d0e9df18-3c25-42b6-819e-6cf7a180ddd1";
const sessionId = "09387a6f-5fb3-4fa4-8fdf-66d72d91bf86";
const context = { params: Promise.resolve({ id }) };
const progress = { positionSeconds: 123.5, durationSeconds: 3600, updatedAt: "2026-10-14T12:00:00.000Z" };
const input = { sessionId, sequence: 1, positionSeconds: 123.5, durationSeconds: 3600, finished: false };
function request(method: string, body?: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/episodes/${id}/playback`, {
    method, headers: { "Content-Type": "application/json", Origin: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("persönliche Hörposition API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.mocked(requireApiUser).mockResolvedValue({ id: "current-user", email: "test@example.com", role: "member" });
    vi.mocked(getEpisodeAudioUrl).mockResolvedValue(`/api/episodes/${id}/audio`);
    vi.mocked(getPlaybackProgress).mockResolvedValue(progress);
    vi.mocked(claimPlayback).mockResolvedValue(progress);
    vi.mocked(savePlaybackProgress).mockResolvedValue(progress);
  });

  it("liest nur den Stand des angemeldeten Benutzers", async () => {
    const response = await GET(request("GET"), context);
    expect(await response.json()).toEqual({ progress });
    expect(getPlaybackProgress).toHaveBeenCalledWith("current-user", id);
  });

  it("übernimmt und speichert die aktuelle Folge unter dem angemeldeten Account", async () => {
    expect((await POST(request("POST", { sessionId, userId: "foreign-user" }), context)).status).toBe(200);
    expect(claimPlayback).toHaveBeenCalledWith("current-user", id, sessionId);
    expect((await PUT(request("PUT", { ...input, userId: "foreign-user" }), context)).status).toBe(200);
    expect(savePlaybackProgress).toHaveBeenCalledWith("current-user", id, input);
  });

  it("erfordert auch zum Lesen eine Anmeldung", async () => {
    vi.mocked(requireApiUser).mockRejectedValue(new AppError("Bitte anmelden", 401, "UNAUTHENTICATED"));
    for (const handler of [GET, POST, PUT]) expect((await handler(request(handler === GET ? "GET" : handler === POST ? "POST" : "PUT", handler === GET ? undefined : input), context)).status).toBe(401);
    expect(getPlaybackProgress).not.toHaveBeenCalled();
    expect(claimPlayback).not.toHaveBeenCalled();
    expect(savePlaybackProgress).not.toHaveBeenCalled();
  });

  it("blockiert fremde Origins vor einem Schreibzugriff", async () => {
    for (const handler of [POST, PUT]) expect((await handler(request(handler === POST ? "POST" : "PUT", input, "https://foreign.example"), context)).status).toBe(403);
    expect(claimPlayback).not.toHaveBeenCalled();
    expect(savePlaybackProgress).not.toHaveBeenCalled();
  });

  it("meldet fehlende Originalaufnahmen", async () => {
    vi.mocked(getEpisodeAudioUrl).mockResolvedValue(null);
    expect((await GET(request("GET"), context)).status).toBe(404);
    expect((await POST(request("POST", { sessionId }), context)).status).toBe(404);
  });

  it("weist ungültige Positionen, Dauern, Sequenzen und Sitzungen zurück", async () => {
    for (const invalid of [
      { positionSeconds: -1 }, { positionSeconds: 4000 }, { durationSeconds: 0 },
      { durationSeconds: 604801 }, { sequence: 0 }, { sequence: 1.5 }, { sessionId: "invalid" },
    ]) expect((await PUT(request("PUT", { ...input, ...invalid }), context)).status).toBe(422);
    expect(savePlaybackProgress).not.toHaveBeenCalled();
  });

  it("meldet einen Gerätewechsel als Konflikt", async () => {
    vi.mocked(savePlaybackProgress).mockRejectedValue(new AppError("Anderes Gerät", 409, "PLAYBACK_REPLACED"));
    const response = await PUT(request("PUT", input), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PLAYBACK_REPLACED");
  });
});
