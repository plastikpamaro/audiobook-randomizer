import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

// Request delays and failures must reach the test routes rather than the PWA worker.
test.use({ serviceWorkers: "block" });

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/")) return;
  await page.getByLabel("E-Mail").fill(email!);
  await page.getByLabel("Passwort", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function seedSelection(page: Page, episodeCount = 2) {
  const seed = await page.evaluate(async (count) => {
    const request = async (url: string, body?: unknown, method = "POST") => {
      const response = await fetch(url, body === undefined ? undefined : {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || url);
      return payload;
    };
    const current = await request("/api/draw/current");
    if (current.draw) await request(`/api/draws/${current.draw.id}/skip`, {});
    const suffix = crypto.randomUUID().slice(0, 8);
    const items = [];
    for (const index of [1, 2]) {
      const seriesName = `Alltag ${index} ${suffix}`;
      const series = await request("/api/series", { name: seriesName, episodeCount: index === 1 ? count : 1 });
      items.push({ seriesId: series.id as string, seriesName });
    }
    const name = `Mein Profil ${suffix}`;
    const preset = await request("/api/presets", { name, seriesIds: [items[0].seriesId] });
    return { items, presetId: preset.id as string, name };
  }, episodeCount);
  await page.reload();
  return seed;
}

async function cleanup(page: Page, seed: Awaited<ReturnType<typeof seedSelection>>) {
  await page.evaluate(async ({ items, presetId }) => {
    await fetch(`/api/presets/${presetId}`, { method: "DELETE" });
    for (const item of items) await fetch(`/api/series/${item.seriesId}`, { method: "DELETE" });
  }, seed);
}

test.describe("Alltägliche Bedienung", () => {
  test.skip(!email || !password, "E2E_EMAIL und E2E_PASSWORD fehlen.");

  test("bearbeitet das bestehende Profil und merkt auch eine leere freie Auswahl", async ({ page, browser, baseURL }) => {
    await login(page);
    const seed = await seedSelection(page);
    const picker = page.getByLabel("Gespeichertes Preset auswählen");
    const renamed = `${seed.name} geändert`;
    try {
      await page.getByRole("button", { name: "Profil bearbeiten" }).click();
      const dialog = page.getByRole("dialog", { name: "Profil bearbeiten" });
      await dialog.getByLabel("Profilname").fill(renamed);
      await dialog.getByRole("checkbox", { name: seed.items[1].seriesName }).check();
      await dialog.getByRole("button", { name: "Änderungen speichern" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(picker).toHaveValue(seed.presetId);
      await expect(picker.locator(`option[value="${seed.presetId}"]`)).toHaveText(renamed);
      await page.reload();
      await expect(picker.locator(`option[value="${seed.presetId}"]`)).toHaveText(renamed);
      for (const item of seed.items) await expect(page.locator(".series-option").filter({ hasText: item.seriesName }).getByRole("checkbox")).toBeChecked();
      const presets = await page.evaluate(async () => (await fetch("/api/presets").then((response) => response.json())).presets);
      expect(presets.filter((preset: { id: string }) => preset.id === seed.presetId)).toHaveLength(1);
      expect(presets.some((preset: { name: string }) => preset.name === seed.name)).toBe(false);

      await page.evaluate(async () => {
        const response = await fetch("/api/settings/preset", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presetId: null, seriesIds: [] }),
        });
        if (!response.ok) throw new Error("Freie Auswahl nicht gespeichert");
      });
      await page.reload();
      await expect(picker).toHaveValue("");
      await expect(page.locator(".series-picker input:checked")).toHaveCount(0);
      await picker.selectOption(seed.presetId);
      await expect(picker).toBeEnabled();
      await picker.selectOption("");
      await expect(picker).toBeEnabled();
      await expect(page.locator(".series-picker input:checked")).toHaveCount(0);
      const firstCheckbox = page.locator(".series-option").filter({ hasText: seed.items[0].seriesName }).getByRole("checkbox");
      await firstCheckbox.check();
      await expect(firstCheckbox).toBeEnabled();
      await page.reload();
      await expect(firstCheckbox).toBeChecked();
      await expect(page.locator(".series-picker input:checked")).toHaveCount(1);
      const otherContext = await browser.newContext({ baseURL });
      try {
        const otherPage = await otherContext.newPage();
        await login(otherPage);
        await expect(otherPage.locator(".series-picker input:checked")).toHaveCount(1);
        await expect(otherPage.locator(".series-option").filter({ hasText: seed.items[0].seriesName }).getByRole("checkbox")).toBeChecked();
      } finally { await otherContext.close(); }
    } finally { await cleanup(page, seed); }
  });

  test("schützt Notizen beim Abgleich, speichert neueren Text und zieht direkt eine andere Folge", async ({ page }) => {
    await login(page);
    const seed = await seedSelection(page);
    let releaseFirstSave: () => void = () => {};
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const sentNotes: string[] = [];
    try {
      const drawn = page.waitForResponse((response) => response.url().endsWith("/api/draw") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Zufällige Folge ziehen" }).click();
      const initial = (await (await drawn).json()).draw;
      const textarea = page.getByLabel("Private Notiz");
      await expect(textarea).toBeVisible();
      await page.route(`**/api/episodes/${initial.episode.id}/preference`, async (route) => {
        const note = route.request().postDataJSON().note;
        if (typeof note === "string") {
          sentNotes.push(note);
          if (sentNotes.length === 1) await firstSaveGate;
        }
        await route.continue();
      });
      await textarea.fill("Entwurf während des Abgleichs");
      let refresh = page.waitForResponse((response) => response.url().endsWith("/api/draw/current"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await refresh;
      await expect(textarea).toHaveValue("Entwurf während des Abgleichs");
      await expect.poll(() => sentNotes.length).toBe(1);
      await textarea.fill("Neuer Text während des Speicherns");
      refresh = page.waitForResponse((response) => response.url().endsWith("/api/draw/current"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await refresh;
      await expect(textarea).toHaveValue("Neuer Text während des Speicherns");
      await page.locator("nav:visible").getByRole("link", { name: "Bibliothek", exact: true }).click();
      await expect(page).toHaveURL(/\/bibliothek$/);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.locator("nav:visible").getByRole("link", { name: "Ziehen", exact: true }).click();
      await expect(textarea).toHaveValue("Neuer Text während des Speicherns");
      await textarea.fill("Text nach dem Seitenwechsel");
      releaseFirstSave();
      await expect.poll(() => sentNotes).toEqual(["Entwurf während des Abgleichs", "Text nach dem Seitenwechsel"]);
      await expect(page.locator(".note-field + small")).toHaveText("Notiz gespeichert.");
      await page.reload();
      await expect(textarea).toHaveValue("Text nach dem Seitenwechsel");

      await textarea.fill("Vor dem Wechsel sofort sichern");
      const replaced = page.waitForResponse((response) => response.url().endsWith(`/api/draws/${initial.id}/next`));
      await page.getByRole("button", { name: "Andere Folge" }).click();
      await expect(textarea).toBeEnabled();
      const next = (await (await replaced).json()).draw;
      expect(next.episode.id).not.toBe(initial.episode.id);
      expect(next.selectionSeriesIds).toEqual(initial.selectionSeriesIds);
      const oldNote = await page.evaluate(async (id) => {
        const payload = await fetch("/api/episodes").then((response) => response.json());
        return payload.episodes.find((episode: { id: string }) => episode.id === id).note;
      }, initial.episode.id);
      expect(oldNote).toBe("Vor dem Wechsel sofort sichern");
      await page.reload();
      const reloaded = await page.evaluate(async () => (await fetch("/api/draw/current").then((response) => response.json())).draw);
      expect(reloaded.id).toBe(next.id);
    } finally {
      releaseFirstSave();
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      if (!page.isClosed()) await cleanup(page, seed).catch(() => {});
    }
  });

  test("behält einen fehlgeschlagenen Notizentwurf und überspringt ohne Alternative nichts", async ({ page }) => {
    await login(page);
    const seed = await seedSelection(page, 1);
    try {
      const drawn = page.waitForResponse((response) => response.url().endsWith("/api/draw") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Zufällige Folge ziehen" }).click();
      const initial = (await (await drawn).json()).draw;
      const textarea = page.getByLabel("Private Notiz");
      await expect(textarea).toBeVisible();
      const endpoint = `**/api/episodes/${initial.episode.id}/preference`;
      await page.route(endpoint, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Speichern gerade nicht möglich" }) }));
      await textarea.fill("Diesen Entwurf behalten");
      await page.getByRole("button", { name: "Andere Folge" }).click();
      await expect(page.locator(".note-field + small")).toContainText("Speichern gerade nicht möglich");
      await expect(textarea).toHaveValue("Diesen Entwurf behalten");
      await page.reload();
      await expect(textarea).toHaveValue("Diesen Entwurf behalten");
      await page.unroute(endpoint);
      await page.getByRole("button", { name: "Notiz speichern", exact: true }).click();
      await expect(page.locator(".note-field + small")).toHaveText("Notiz gespeichert.");
      await page.getByRole("button", { name: "Andere Folge" }).click();
      await expect(page.getByRole("status")).toContainText("keine andere ungehörte Folge");
      const unchanged = await page.evaluate(async () => (await fetch("/api/draw/current").then((response) => response.json())).draw);
      expect(unchanged.id).toBe(initial.id);
      expect(unchanged.episode.note).toBe("Diesen Entwurf behalten");
    } finally { await page.unrouteAll({ behavior: "wait" }); await cleanup(page, seed); }
  });
});
