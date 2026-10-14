import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const storage = process.env.AUDIO_STORAGE_PATH;
test.use({ serviceWorkers: "block" });

// Generated silence, rather than recordings from the user's library.
function silentWave() {
  const samples = 90 * 8000;
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(samples * 2, 40);
  return data;
}

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/")) return;
  await page.getByLabel("E-Mail").fill(email!);
  await page.getByLabel("Passwort", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function seed(page: Page) {
  const seeded = await page.evaluate(async (suffix) => {
    async function request(url: string, body?: object, method = "POST") {
      const response = await fetch(url, body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || url);
      return result;
    }
    const current = await request("/api/draw/current");
    if (current.draw) await request(`/api/draws/${current.draw.id}/skip`, {});
    const series = await request("/api/series", { name: `Audio-Test ${suffix}`, episodeCount: 1 });
    const episodes = (await request("/api/episodes")).episodes;
    const episode = episodes.find((item: { seriesId: string }) => item.seriesId === series.id);
    return { seriesId: series.id as string, episodeId: episode.id as string };
  }, randomUUID().slice(0, 8));
  const directory = resolve(storage!);
  if (!directory.includes(`${sep}.tmp${sep}`)) throw new Error("Audio-E2E benötigt ein eigenes .tmp-Verzeichnis.");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${seeded.episodeId}.mp3`), silentWave());
  await page.evaluate(async (seriesId) => {
    const response = await fetch("/api/draw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seriesIds: [seriesId] }) });
    if (!response.ok) throw new Error("Testfolge konnte nicht gezogen werden");
  }, seeded.seriesId);
  return seeded;
}

async function openPlayer(page: Page, episodeId: string) {
  await page.route(`**/api/episodes/${episodeId}/audio`, (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: silentWave() }));
  await page.goto("/");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
  await expect(page.locator(".episode-audio-player")).not.toContainText("Hörposition wird geladen");
}

async function start(page: Page) {
  await page.locator("audio").click({ position: { x: 20, y: 27 } });
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
}

async function progress(page: Page, episodeId: string) {
  return page.evaluate(async (id) => (await fetch(`/api/episodes/${id}/playback`).then((response) => response.json())).progress.positionSeconds as number, episodeId);
}

test.describe("Originalfassungen weiterhören", () => {
  test.skip(!email || !password || !storage, "E2E-Zugang und isoliertes AUDIO_STORAGE_PATH fehlen.");

  test("synchronisiert Pause und Zurückspulen zwischen zwei Geräten und schützt vor dem alten Player", async ({ page, browser, baseURL }) => {
    await login(page);
    const seeded = await seed(page);
    const secondContext = await browser.newContext({ baseURL, serviceWorkers: "block" });
    try {
      await openPlayer(page, seeded.episodeId);
      await start(page);
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 22; });
      await expect.poll(() => progress(page, seeded.episodeId)).toBeGreaterThanOrEqual(22);
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.pause());
      const paused = await progress(page, seeded.episodeId);

      const second = await secondContext.newPage();
      await login(second);
      await openPlayer(second, seeded.episodeId);
      await expect.poll(() => second.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(paused - 0.5);
      await start(second);
      await second.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 31; audio.pause(); });
      await expect.poll(() => progress(second, seeded.episodeId)).toBeGreaterThanOrEqual(31);
      // A late seek/save from the first device must not rewind the second one.
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 9; });
      await expect(page.locator(".episode-audio-player")).toContainText("anderen Gerät");
      expect(await progress(second, seeded.episodeId)).toBeGreaterThanOrEqual(31);

      await start(page);
      await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(31);
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 12; audio.pause(); });
      await expect.poll(() => progress(page, seeded.episodeId)).toBeLessThan(13);
      await page.reload();
      await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(12);
      expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    } finally {
      await secondContext.close();
      await page.evaluate(async (id) => { await fetch(`/api/series/${id}`, { method: "DELETE" }); }, seeded.seriesId);
      await unlink(resolve(storage!, `${seeded.episodeId}.mp3`));
    }
  });

  test("speichert während der Wiedergabe und beim Verlassen und setzt am Ende auf null zurück", async ({ page }) => {
    await login(page);
    const seeded = await seed(page);
    try {
      await openPlayer(page, seeded.episodeId);
      await start(page);
      const initial = await progress(page, seeded.episodeId);
      await expect.poll(() => progress(page, seeded.episodeId), { timeout: 10_000 }).toBeGreaterThan(initial + 3);
      const departure = await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime);
      await page.goto("/bibliothek");
      await expect.poll(() => progress(page, seeded.episodeId)).toBeGreaterThanOrEqual(departure - 0.5);
      // The same player also resumes inside the targeted-listening dialog.
      const row = page.locator(".episode-table tbody tr").filter({ hasText: `Audio-Test` }).filter({ hasText: "Folge 1" }).first();
      await row.getByRole("button", { name: /gezielt hören/i }).click();
      await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(departure - 0.5);
      await start(page);
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 89.5; });
      await expect(page.locator(".episode-audio-player")).toContainText("Zu Ende gehört", { timeout: 10_000 });
      expect(await progress(page, seeded.episodeId)).toBe(0);
      await page.getByRole("button", { name: "Schließen", exact: true }).last().click();
      await page.goto("/");
      await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBe(0);
    } finally {
      await page.goto("/");
      await page.evaluate(async (id) => { await fetch(`/api/series/${id}`, { method: "DELETE" }); }, seeded.seriesId);
      await unlink(resolve(storage!, `${seeded.episodeId}.mp3`));
    }
  });
});
