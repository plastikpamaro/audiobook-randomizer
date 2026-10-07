import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), setActivePreset: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/catalog", () => ({ setActivePreset: mocks.setActivePreset }));

import { PUT } from "@/app/api/settings/preset/route";
import { AppError } from "@/lib/app-error";

const origin = "https://example.org";
const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const presetId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const request = (body: unknown, requestOrigin: string | null = origin) => new Request(`${origin}/api/settings/preset`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", ...(requestOrigin === null ? {} : { Origin: requestOrigin }) },
  body: JSON.stringify(body),
});

describe("Aktives Preset API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN", origin);
    mocks.requireUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([presetId, null])("speichert %s für den angemeldeten Nutzer", async (selection) => {
    const response = await PUT(request({ presetId: selection, userId: "anderer-nutzer" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.setActivePreset).toHaveBeenCalledExactlyOnceWith(userId, selection);
  });

  it.each([{}, { presetId: "invalid" }, { presetId: "" }, { presetId: 123 }, null])("weist ungültige Eingaben %j ohne Schreiben ab", async (body) => {
    const response = await PUT(request(body));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.setActivePreset).not.toHaveBeenCalled();
  });

  it.each(["https://untrusted.example.org", null])("blockiert Origin %s vor Authentifizierung und Schreiben", async (requestOrigin) => {
    const response = await PUT(request({ presetId }, requestOrigin));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.setActivePreset).not.toHaveBeenCalled();
  });

  it("schreibt ohne Anmeldung nichts", async () => {
    mocks.requireUser.mockRejectedValueOnce(new AppError("Bitte melde dich an.", 401, "UNAUTHENTICATED"));
    const response = await PUT(request({ presetId }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.setActivePreset).not.toHaveBeenCalled();
  });

  it("gibt ein nicht gefundenes Preset als 404 zurück", async () => {
    mocks.setActivePreset.mockRejectedValueOnce(new AppError("Preset nicht gefunden.", 404, "NOT_FOUND"));
    const response = await PUT(request({ presetId }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Preset nicht gefunden.", code: "NOT_FOUND" });
    expect(mocks.setActivePreset).toHaveBeenCalledExactlyOnceWith(userId, presetId);
  });
});
