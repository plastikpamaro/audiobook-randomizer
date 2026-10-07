import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/app-error";

const mocks = vi.hoisted(() => ({ next: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/randomizer", () => ({ skipAndDrawNext: mocks.next }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.user }));

import { POST } from "@/app/api/draws/[id]/next/route";

const drawId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const request = (origin: string | null = "https://example.org") => new Request(`https://example.org/api/draws/${drawId}/next`, {
  method: "POST",
  headers: origin ? { Origin: origin } : {},
});
const context = (id = drawId) => ({ params: Promise.resolve({ id }) });

describe("Andere Folge API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.APP_ORIGIN = "https://example.org";
    mocks.user.mockResolvedValue({ id: "member" });
    mocks.next.mockResolvedValue({ id: "replacement", status: "active" });
  });

  it("gibt den atomaren Ersatz für den angemeldeten Nutzer zurück", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draw: { id: "replacement", status: "active" } });
    expect(mocks.next).toHaveBeenCalledWith("member", drawId);
  });

  it.each(["ungueltig", "", "1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"])("verweigert ungültige Ziehungs-ID %s", async (id) => {
    const response = await POST(request(), context(id));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("VALIDATION_ERROR");
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it.each([null, "https://fremd.example.org"])("schreibt bei unzulässiger Origin %s nichts", async (origin) => {
    const response = await POST(request(origin), context());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("INVALID_ORIGIN");
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("verlangt einen angemeldeten Nutzer", async () => {
    mocks.user.mockRejectedValue(new AppError("Bitte anmelden.", 401, "UNAUTHENTICATED"));
    const response = await POST(request(), context());
    expect(response.status).toBe(401);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it.each(["NO_ALTERNATIVE", "ALREADY_RESOLVED"])("erhält den Konfliktcode %s", async (code) => {
    mocks.next.mockRejectedValue(new AppError("Keine weitere Folge verfügbar.", 409, code));
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(code);
  });
});
