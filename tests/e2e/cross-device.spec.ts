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

    await page.goto("/verlauf");
    await page.getByPlaceholder("Titel, Nummer oder Serie").fill(seed.title);
    const historyRow = page.locator(".history-row").filter({ hasText: seed.title }).first();
    await expect(historyRow).toContainText("E2E-Notiz über mehrere Geräte");
    await historyRow.getByRole("button", { name: "Zurückholen" }).click();
    await expect(page.locator(".history-row").filter({ hasText: seed.title }).first()).toContainText("Korrigiert");

    await page.evaluate(async (seriesId) => {
      const result = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesIds: [seriesId] }),
      }).then((response) => response.json());
      await fetch(`/api/draws/${result.draw.id}/heard`, { method: "POST" });
    }, seed.seriesId);

    await page.goto("/bibliothek");
    await page.getByPlaceholder("Titel, Nummer oder Serie").fill(seed.title);
    await page.getByLabel("Status").selectOption("heard");
    await page.getByLabel("Nur Favoriten").check();
    await expect(page.locator(".episode-table tbody tr").filter({ hasText: seed.title })).toBeVisible();

    await page.goto("/statistik");
    await page.getByLabel("Von").fill("2000-01-01");
    await page.getByLabel("Bis").fill("2100-01-01");
    await page.getByRole("button", { name: "Anwenden" }).click();
    await expect(page.locator(".metric-card").filter({ hasText: "Gehört" }).locator(".stat-value")).not.toHaveText("0");
    await page.getByRole("button", { name: "Woche" }).click();
    await page.getByRole("button", { name: "Monat" }).click();
    await page.getByRole("button", { name: "Tag", exact: true }).click();
  });
});
