import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteSource: vi.fn(), updateSource: vi.fn(), requireUser: vi.fn(), origin: vi.fn(),
}));
vi.mock("@/lib/online-import-service", () => ({
  deleteImportSource: mocks.deleteSource, updateImportSource: mocks.updateSource,
}));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/http", () => ({
  assertMutationOrigin: mocks.origin,
  jsonBody: (request: Request) => request.json(),
  errorResponse: () => Response.json({ error: "Abgelehnt" }, { status: 403 }),
}));
import { DELETE, PATCH } from "@/app/api/import-sources/[id]/route";

const context = { params: Promise.resolve({ id: "dc80b738-50db-41d6-a9bd-8d80b73850db" }) };

describe("Online-Quellen löschen und pausieren", () => {
  beforeEach(() => vi.resetAllMocks());

  it("löscht über DELETE endgültig und deaktiviert nicht lediglich", async () => {
    const response = await DELETE(new Request("https://example.org/api/import-sources/test", { method: "DELETE" }), context);
    expect(response.status).toBe(200);
    expect(mocks.requireUser).toHaveBeenCalledWith(["owner", "admin"]);
    expect(mocks.deleteSource).toHaveBeenCalledWith((await context.params).id);
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });

  it("erhält das separate Pausieren über PATCH", async () => {
    const response = await PATCH(new Request("https://example.org/api/import-sources/test", {
      method: "PATCH", body: JSON.stringify({ enabled: false }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateSource).toHaveBeenCalledWith((await context.params).id, { enabled: false });
    expect(mocks.deleteSource).not.toHaveBeenCalled();
  });

  it.each(["origin", "requireUser"] as const)("löscht bei fehlgeschlagener Prüfung %s nichts", async (check) => {
    mocks[check].mockImplementation(() => { throw new Error("Abgelehnt"); });
    const response = await DELETE(new Request("https://example.org/api/import-sources/test", { method: "DELETE" }), context);
    expect(response.status).toBe(403);
    expect(mocks.deleteSource).not.toHaveBeenCalled();
  });
});
