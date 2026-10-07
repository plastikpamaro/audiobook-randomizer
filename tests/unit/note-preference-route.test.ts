import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.user }));
vi.mock("@/lib/catalog", () => ({ upsertPreference: mocks.upsert }));
import { PATCH } from "@/app/api/episodes/[id]/preference/route";

const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const episodeId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const origin = "https://example.org";
const context = { params: Promise.resolve({ id: episodeId }) };
const request = (body: unknown) => new Request(`${origin}/api/episodes/${episodeId}/preference`, {
  method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("Notizen bei einem Accountwechsel", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("APP_ORIGIN", origin);
    mocks.user.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("speichert automatische Notizen für den erwarteten angemeldeten Account", async () => {
    expect((await PATCH(request({ note: "Entwurf", expectedUserId: userId }), context)).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(userId, episodeId, { note: "Entwurf" });
  });

  it("verhindert, dass eine alte Speicheranfrage in einen anderen Account schreibt", async () => {
    const response = await PATCH(request({ note: "Privater Entwurf", expectedUserId: otherUserId }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SESSION_CHANGED" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("unterstützt bisherige Notiz- und Favoritenanfragen ohne Accountbindung", async () => {
    expect((await PATCH(request({ note: "", favorite: true }), context)).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(userId, episodeId, { note: "", favorite: true });
  });
});
