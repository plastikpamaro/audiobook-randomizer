import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), requireUser: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/online-import-service", () => ({ resolveImportProposals: mocks.resolve }));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/http", () => ({ assertMutationOrigin: mocks.origin, jsonBody: (request: Request) => request.json(), errorResponse: () => Response.json({ error: "Abgelehnt" }, { status: 422 }) }));
import { POST } from "@/app/api/import-proposals/bulk/route";

const ids = ["dc80b738-50db-41d6-a9bd-8d80b73850db", "dc80b738-50db-41d6-a9bd-8d80b73850dc"];
const request = (body: unknown) => new Request("https://example.org/api/import-proposals/bulk", { method: "POST", body: JSON.stringify(body) });

describe("Sammelprüfung", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: "owner" }); });
  it.each(["accept", "reject"])("übermittelt %s als gemeinsame Aktion", async (action) => {
    expect((await POST(request({ proposalIds: ids, action }))).status).toBe(200);
    expect(mocks.requireUser).toHaveBeenCalledWith(["owner", "admin"]);
    expect(mocks.resolve).toHaveBeenCalledWith("owner", ids, action);
  });
  it.each([[], ["invalid"], Array(1001).fill(ids[0])])("weist ungültige Auswahlen ab", async (proposalIds) => {
    expect((await POST(request({ proposalIds, action: "accept" }))).status).toBe(422);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["origin", "requireUser"] as const)("schreibt bei fehlgeschlagener Prüfung %s nichts", async (check) => {
    mocks[check].mockImplementationOnce(() => { throw new Error("Abgelehnt"); });
    expect((await POST(request({ proposalIds: ids, action: "accept" }))).status).toBe(422);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
