import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/")) return;
  await page.getByLabel("E-Mail").fill(email!);
  await page.getByLabel("Passwort", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("geräteübergreifender Zustand", () => {
  test.skip(!email || !password, "E2E_EMAIL und E2E_PASSWORD fehlen.");

  test("zeigt auf zwei Sitzungen dieselbe atomar reservierte Folge", async ({ browser, baseURL }) => {
    const firstContext = await browser.newContext({ baseURL });
    const secondContext = await browser.newContext({ baseURL });
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    await login(first);
    await login(second);

    const seed = await first.evaluate(async () => {
      const current = await fetch("/api/draw/current").then((response) => response.json());
      if (current.draw) await fetch(`/api/draws/${current.draw.id}/skip`, { method: "POST" });
      const suffix = crypto.randomUUID().slice(0, 8);
      const series = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: `e2e-${suffix}`, name: `E2E ${suffix}`, accentColor: "#f0a35b", archived: false }),
      }).then((response) => response.json());
      const title = `Parallele Folge ${suffix}`;
      await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId: series.id, episodeKey: "folge-1", title, priorityOnRelease: false, archived: false, links: [] }),
      });
      const result = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesIds: [series.id] }),
      }).then((response) => response.json());
      return { title, drawId: result.draw.id };
    });

    await first.reload();
    await second.reload();
    await expect(first.getByRole("heading", { name: seed.title })).toBeVisible();
    await expect(second.getByRole("heading", { name: seed.title })).toBeVisible();

    await first.getByRole("button", { name: "Gehört" }).click();
    await expect(first.getByRole("heading", { name: seed.title })).toHaveCount(0);
    await second.reload();
    await expect(second.getByRole("heading", { name: seed.title })).toHaveCount(0);

    await firstContext.close();
    await secondContext.close();
  });

  test("deckt den persönlichen Kernfluss auf Handy und Desktop ab", async ({ page }, testInfo) => {
    await login(page);
    const seed = await page.evaluate(async () => {
      const current = await fetch("/api/draw/current").then((response) => response.json());
      if (current.draw) await fetch(`/api/draws/${current.draw.id}/skip`, { method: "POST" });
      const suffix = crypto.randomUUID().slice(0, 8);
      const seriesName = `Kernfluss ${suffix}`;
      const title = `Sonderfolge ${suffix}`;
      const series = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: `flow-${suffix}`, name: seriesName, accentColor: "#72c69d", archived: false }),
      }).then((response) => response.json());
      await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: series.id,
          episodeKey: "sonderfolge",
          title,
          durationMinutes: 42,
          priorityOnRelease: false,
          archived: false,
          links: [{ label: "Test-Link", url: "https://example.com/hoeren", sortOrder: 0 }],
        }),
      });
      return { seriesId: series.id as string, seriesName, title, presetName: `Preset ${suffix}` };
    });

    await page.reload();
    await expect(page.locator(testInfo.project.name === "mobile" ? ".mobile-nav" : ".sidebar")).toBeVisible();
    const seriesChoice = page.locator(".series-option").filter({ hasText: seed.seriesName });
    const seriesCheckbox = seriesChoice.getByRole("checkbox");
    await expect(seriesCheckbox).toBeChecked();
    await seriesCheckbox.uncheck();
    await expect(seriesCheckbox).not.toBeChecked();
    await seriesCheckbox.check();

    await page.getByRole("button", { name: "Auswahl speichern" }).click();
    const presetForm = page.locator(".inline-form");
    await presetForm.getByPlaceholder("Name, z. B. Detektivabend").fill(seed.presetName);
    await presetForm.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("option", { name: seed.presetName })).toBeAttached();

    await page.evaluate(async (seriesId) => {
      await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesIds: [seriesId] }),
      });
    }, seed.seriesId);
    await page.reload();
    await expect(page.getByRole("heading", { name: seed.title })).toBeVisible();
    await page.getByLabel("Private Notiz").fill("E2E-Notiz über mehrere Geräte");
    await page.getByRole("button", { name: "Notiz speichern" }).click();
    await expect(page.getByRole("status")).toContainText("Notiz gespeichert");
    await page.getByRole("button", { name: "Als Favorit merken" }).click();
    await expect(page.getByRole("button", { name: "Favorit entfernen" })).toBeVisible();
    await page.getByRole("button", { name: "Gehört" }).click();
    await expect(page.getByRole("heading", { name: seed.title })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Wie war die Folge?" })).toBeVisible();
    await page.getByRole("radio", { name: "9" }).click();
    await page.getByRole("button", { name: "Bewertung speichern" }).click();
    await expect(page.getByRole("heading", { name: "Wie war die Folge?" })).toHaveCount(0);

    await page.goto("/verlauf");
    await page.getByPlaceholder("Titel, Nummer oder Serie").fill(seed.title);
    const historyRow = page.locator(".history-row").filter({ hasText: seed.title }).first();
    await expect(historyRow).toContainText("E2E-Notiz über mehrere Geräte");
    await expect(historyRow.getByRole("combobox")).toHaveValue("9");
    await historyRow.getByRole("button", { name: "Zurückholen" }).click();
    await expect(page.locator(".history-row").filter({ hasText: seed.title }).first()).toContainText("Korrigiert");
    await expect(page.locator(".history-row").filter({ hasText: seed.title }).first()).toContainText("9/10");

    await page.evaluate(async (seriesId) => {
      const result = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesIds: [seriesId] }),
      }).then((response) => response.json());
      await fetch(`/api/draws/${result.draw.id}/heard`, { method: "POST" });
      await fetch(`/api/draws/${result.draw.id}/rating`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score: 8 }),
      });
    }, seed.seriesId);

    await page.goto("/bibliothek");
    await page.getByPlaceholder("Titel, Nummer oder Serie").fill(seed.title);
    await page.getByLabel("Status").selectOption("heard");
    await page.getByLabel("Nur Favoriten").check();
    await expect(page.locator(".episode-table tbody tr").filter({ hasText: seed.title })).toBeVisible();
    await expect(page.locator(".episode-table tbody tr").filter({ hasText: seed.title })).toContainText("8");

    await page.goto("/statistik");
    await page.getByLabel("Von").fill("2000-01-01");
    await page.getByLabel("Bis").fill("2100-01-01");
    await page.getByRole("button", { name: "Anwenden" }).click();
    await expect(page.locator(".metric-card").filter({ hasText: "Gehört" }).locator(".stat-value")).not.toHaveText("0");
    await expect(page.locator(".metric-card").filter({ hasText: "Ø Bewertung" })).toContainText("8");
    await page.getByRole("button", { name: "Woche" }).click();
    await page.getByRole("button", { name: "Monat" }).click();
    await page.getByRole("button", { name: "Tag", exact: true }).click();
  });

  test("führt durch Online-Quellen-Vorschau, Zuordnung und Sync", async ({ page }) => {
    await login(page);
    const seeded = await page.evaluate(async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const series = await fetch("/api/series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: `source-${suffix}`, name: `Quellserie ${suffix}`, accentColor: "#f0a35b", archived: false }),
      }).then((response) => response.json());
      const episode = await fetch("/api/episodes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId: series.id, episodeKey: "vorhanden", title: "Schon vorhanden", priorityOnRelease: false, archived: false, links: [] }),
      }).then((response) => response.json());
      return { seriesId: series.id as string, seriesName: `Quellserie ${suffix}`, episodeId: episode.id as string };
    });

    const sourceId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    let commitBody: { resolutions?: unknown[] } | null = null;
    const source = { id: sourceId, seriesId: seeded.seriesId, seriesName: seeded.seriesName, kind: "json", name: "E2E Feed", url: "https://example.org/feed.json", enabled: true, confirmed: true, lastCheckedAt: null, lastSuccessAt: null, lastError: null, lastItemCount: 2, pendingProposalCount: 0 };
    await page.route("**/api/import-sources", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: sourceId }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sources: [source], proposals: [] }) });
    });
    await page.route("**/api/import-sources/preview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      run: { id: runId, sourceId, triggerType: "preview", status: "awaiting_confirmation", fetchedItemCount: 2, newItemCount: 2, changedItemCount: 0, invalidItemCount: 0, warningCount: 0, errorMessage: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      warnings: [],
      proposals: [
        { id: "33333333-3333-4333-8333-333333333333", sourceId, runId, externalId: "new", proposalType: "create", candidateEpisodeId: null, candidateTitle: null, episode: { externalId: "new", title: "Ganz neu", numberLabel: "2", sortOrder: 2, releaseDate: null, durationMinutes: null, priorityOnRelease: false, links: [], canonicalUrl: null }, fieldChanges: {}, status: "pending" },
        { id: "44444444-4444-4444-8444-444444444444", sourceId, runId, externalId: "old", proposalType: "link", candidateEpisodeId: seeded.episodeId, candidateTitle: "Schon vorhanden", episode: { externalId: "old", title: "Schon vorhanden", numberLabel: "1", sortOrder: 1, releaseDate: null, durationMinutes: null, priorityOnRelease: false, links: [], canonicalUrl: null }, fieldChanges: {}, status: "pending" },
      ],
    }) }));
    await page.route("**/api/import-sources/commit", async (route) => {
      commitBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route(`**/api/import-sources/${sourceId}/sync`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { ...source, id: runId, sourceId, status: "succeeded" } }) }));

    await page.goto("/bibliothek");
    await page.getByRole("button", { name: "Quelle hinzufügen" }).click();
    await page.getByLabel("Quellentyp").selectOption("json");
    await page.getByLabel("Anzeigename").fill("E2E Feed");
    await page.getByLabel("Öffentliche HTTPS-URL").fill("https://example.org/feed.json");
    await page.getByLabel("Zielserie").selectOption(seeded.seriesId);
    await page.getByRole("button", { name: "Vorschau laden" }).click();
    await expect(page.getByRole("heading", { name: "2 Einträge prüfen" })).toBeVisible();
    await expect(page.getByText("Vorschlag: Schon vorhanden")).toBeVisible();
    await page.getByRole("button", { name: "Entscheidungen bestätigen" }).click();
    await expect.poll(() => commitBody?.resolutions?.length || 0).toBe(2);
    await expect(page.getByText("Quelle bestätigt und tägliche Synchronisierung aktiviert.")).toBeVisible();
    await page.getByRole("button", { name: "Jetzt prüfen" }).click();
    await expect(page.getByText("Quelle wurde geprüft.")).toBeVisible();
  });
});
