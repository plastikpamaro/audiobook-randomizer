import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSource: vi.fn(), requireUser: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/online-import-service", () => ({
  createImportSource: mocks.createSource, getImportProposals: vi.fn(), getImportSources: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/http", () => ({
  assertMutationOrigin: mocks.origin,
  jsonBody: (request: Request) => request.json(),
  errorResponse: () => Response.json({ error: "Abgelehnt" }, { status: 403 }),
}));
import { POST } from "@/app/api/import-sources/route";

describe("Sherlock-Holmes-Quellen anlegen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "owner" });
    mocks.createSource.mockResolvedValue("source");
  });

  it.each(["sherlock_original", "sherlock_reloaded", "sherlock_neue"])("akzeptiert %s ohne eigene Feed-URL", async (kind) => {
    const input = { seriesId: "dc80b738-50db-41d6-a9bd-8d80b73850db", kind, name: "Sherlock Holmes", url: null };
    const response = await POST(new Request("https://example.org/api/import-sources", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "source" });
    expect(mocks.requireUser).toHaveBeenCalledWith(["owner", "admin"]);
    expect(mocks.createSource).toHaveBeenCalledWith("owner", input);
  });
});
