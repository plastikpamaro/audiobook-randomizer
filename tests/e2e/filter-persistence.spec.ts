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

test.describe("gemerkte Bibliotheks- und Verlaufsfilter", () => {
  test.skip(!email || !password, "E2E_EMAIL und E2E_PASSWORD fehlen.");

  test("behält alle Filter über Navigation und Neuladen und lässt sie zurücksetzen", async ({ page }) => {
    await login(page);
    const seriesId = await page.evaluate(async () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const response = await fetch("/api/series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: `filter-${suffix}`, name: `Filter ${suffix}`, accentColor: "#72c69d", archived: false }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return payload.id as string;
    });

    async function expectLibraryFilters() {
      await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("Sonderfolge 7");
      await expect(page.getByRole("combobox", { name: "Serie", exact: true })).toHaveValue(seriesId);
      await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("future");
      await expect(page.getByLabel("Erschienen ab")).toHaveValue("2026-01-01");
      await expect(page.getByLabel("Erschienen bis")).toHaveValue("2026-12-31");
      await expect(page.getByLabel("Nur Favoriten")).toBeChecked();
    }

    async function expectLibraryDefaults() {
      await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("");
      await expect(page.getByRole("combobox", { name: "Serie", exact: true })).toHaveValue("all");
      await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");
      await expect(page.getByLabel("Erschienen ab")).toHaveValue("");
      await expect(page.getByLabel("Erschienen bis")).toHaveValue("");
      await expect(page.getByLabel("Nur Favoriten")).not.toBeChecked();
    }

    async function expectHistoryFilters() {
      await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("Krimi 9");
      await expect(page.getByRole("combobox", { name: "Aktion", exact: true })).toHaveValue("skipped");
      await expect(page.getByLabel("Nur Favoriten")).toBeChecked();
    }

    try {
      await page.goto("/bibliothek");
      await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
      await page.getByLabel("Suche", { exact: true }).fill("Sonderfolge 7");
      await page.getByRole("combobox", { name: "Serie", exact: true }).selectOption(seriesId);
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("future");
      await page.getByLabel("Erschienen ab").fill("2026-01-01");
      await page.getByLabel("Erschienen bis").fill("2026-12-31");
      await page.getByLabel("Nur Favoriten").check();
      await page.reload();
      await expectLibraryFilters();

      await page.goto("/verlauf");
      await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
      await page.getByLabel("Suche", { exact: true }).fill("Krimi 9");
      await page.getByRole("combobox", { name: "Aktion", exact: true }).selectOption("skipped");
      await page.getByLabel("Nur Favoriten").check();
      await page.reload();
      await expectHistoryFilters();
      await page.goto("/bibliothek");
      await expectLibraryFilters();
      await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
      await expectLibraryDefaults();
      await page.reload();
      await expectLibraryDefaults();

      await page.goto("/verlauf");
      await expectHistoryFilters();
      await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
      await page.reload();
      await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("");
      await expect(page.getByRole("combobox", { name: "Aktion", exact: true })).toHaveValue("all");
      await expect(page.getByLabel("Nur Favoriten")).not.toBeChecked();
    } finally {
      await page.evaluate(async (id) => { await fetch(`/api/series/${id}`, { method: "DELETE" }); }, seriesId);
    }
  });

  test("fängt beschädigte Filterdaten und gesperrten Browserspeicher ab", async ({ page }) => {
    await login(page);
    await page.goto("/bibliothek");
    await page.getByLabel("Suche", { exact: true }).fill("Wird verworfen");
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("audiobook-randomizer:filters:v1:") && item.endsWith(":library"));
      if (!key) throw new Error("Bibliotheksfilter wurden nicht gespeichert.");
      localStorage.setItem(key, "{broken");
    });
    await page.reload();
    await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");

    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("Browser storage blocked"); } });
    });
    await page.reload();
    await page.getByLabel("Suche", { exact: true }).fill("Funktioniert trotzdem");
    await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("Funktioniert trotzdem");
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
    await expect(page.getByLabel("Suche", { exact: true })).toHaveValue("");
  });
});
