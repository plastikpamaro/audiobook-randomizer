import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), user: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/randomizer", () => ({ recordManualListen: mocks.record }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.user }));
vi.mock("@/lib/http", () => ({ assertMutationOrigin: mocks.origin, jsonBody: (r: Request) => r.json(), errorResponse: () => Response.json({ error: "Abgelehnt" }, { status: 422 }) }));
import { POST } from "@/app/api/listens/manual/route";
const input = { episodeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", requestId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", rating: 8 };
const request = (body: unknown) => new Request("https://example.org/api/listens/manual", { method: "POST", body: JSON.stringify(body) });
describe("Manueller Hördurchlauf API", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "member" }); });
  it("speichert für den angemeldeten Nutzer einschließlich Bewertung und Wiederholschutz", async () => {
    expect((await POST(request(input))).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith("member", input);
  });
  it.each([0, 11, 1.5, "8"])("verweigert ungültige Bewertung %s", async (rating) => {
    expect((await POST(request({ ...input, rating }))).status).toBe(422);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("verlangt eine gültige Request-ID", async () => {
    expect((await POST(request({ ...input, requestId: undefined }))).status).toBe(422);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each(["user", "origin"] as const)("schreibt bei fehlgeschlagener Prüfung %s nichts", async (check) => {
    mocks[check].mockImplementationOnce(() => { throw new Error("Abgelehnt"); });
    expect((await POST(request(input))).status).toBe(422);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
