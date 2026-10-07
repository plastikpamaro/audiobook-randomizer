import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), setActivePreset: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/catalog", () => ({ setActivePreset: mocks.setActivePreset }));

import { PUT } from "@/app/api/settings/preset/route";
import { AppError } from "@/lib/app-error";

const origin = "https://example.org";
const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const seriesId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const request = (body: unknown) => new Request(`${origin}/api/settings/preset`, {
  method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
});

describe("Freie Serienauswahl API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN", origin);
    mocks.requireUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([{ seriesIds: [seriesId] }, { seriesIds: [] }])("speichert die exakte Auswahl %j für den angemeldeten Account", async ({ seriesIds }) => {
    const response = await PUT(request({ presetId: null, seriesIds, userId: "fremder-account" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.setActivePreset).toHaveBeenCalledExactlyOnceWith(userId, null, seriesIds);
  });

  it.each([
    { presetId: null, seriesIds: "all" },
    { presetId: null, seriesIds: ["invalid"] },
    { presetId: null, seriesIds: Array.from({ length: 101 }, () => seriesId) },
    { presetId: seriesId, seriesIds: [] },
  ])("weist ungültige freie Auswahl %j vor dem Schreiben ab", async (body) => {
    const response = await PUT(request(body));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.setActivePreset).not.toHaveBeenCalled();
  });

  it("erhält die bisherige freie Auswahl bei einem alten Aufruf ohne Serien", async () => {
    const response = await PUT(request({ presetId: null }));
    expect(response.status).toBe(200);
    expect(mocks.setActivePreset).toHaveBeenCalledExactlyOnceWith(userId, null);
  });

  it("meldet nicht mehr verfügbare Serien als ungültige Auswahl", async () => {
    mocks.setActivePreset.mockRejectedValueOnce(new AppError("Mindestens eine ausgewählte Serie ist nicht verfügbar.", 422, "INVALID_SELECTION"));
    const response = await PUT(request({ presetId: null, seriesIds: [seriesId] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_SELECTION" });
  });
});
