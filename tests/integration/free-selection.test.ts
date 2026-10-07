import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Persistente freie Serienauswahl", () => {
  let pool: Pool;
  let userId: string;
  let otherUserId: string;
  let seriesIds: string[];

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.toLowerCase().includes("test")) {
      throw new Error("TEST_DATABASE_URL muss auf eine Testdatenbank zeigen.");
    }
    process.env.DATABASE_URL = url;
    process.env.TZ = "Europe/Berlin";
    pool = new Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(`migrations/${file}`, "utf8"));
    }
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const users = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, catalog_baseline_date)
       VALUES ($1, 'x', current_date), ($2, 'x', current_date) RETURNING id`,
      [`free-${suffix}@example.org`, `other-free-${suffix}@example.org`],
    );
    [userId, otherUserId] = users.rows.map((row) => row.id);
    seriesIds = (await pool.query<{ id: string }>(
      "INSERT INTO series (series_key, name) VALUES ($1, 'Erste Serie'), ($2, 'Zweite Serie') RETURNING id",
      [`free-first-${suffix}`, `free-second-${suffix}`],
    )).rows.map((row) => row.id);
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  it("unterscheidet die anfängliche Standardauswahl von einer explizit leeren Auswahl und trennt Accounts", async () => {
    const { getActivePresetId, getFreeSelectionSeriesIds, setActivePreset } = await import("@/lib/catalog");
    expect(await getFreeSelectionSeriesIds(userId)).toBeNull();
    await setActivePreset(userId, null, [seriesIds[1], seriesIds[0]]);
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([seriesIds[1], seriesIds[0]]);
    expect(await getFreeSelectionSeriesIds(otherUserId)).toBeNull();
    await setActivePreset(userId, null, []);
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([]);
    expect(await getActivePresetId(userId)).toBeNull();
  });

  it("erhält die freie Auswahl über Profilwechsel und den alten Aufruf ohne Serien hinweg", async () => {
    const { getActivePresetId, getFreeSelectionSeriesIds, savePreset, setActivePreset } = await import("@/lib/catalog");
    await setActivePreset(userId, null, [seriesIds[0]]);
    const presetId = await savePreset(userId, { name: "Profil", seriesIds: [seriesIds[1]] });
    expect(await getActivePresetId(userId)).toBe(presetId);
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([seriesIds[0]]);
    await setActivePreset(userId, null);
    expect(await getActivePresetId(userId)).toBeNull();
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([seriesIds[0]]);
    await setActivePreset(userId, presetId);
    await setActivePreset(userId, null, []);
    expect(await getActivePresetId(userId)).toBeNull();
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([]);
  });

  it("weist fehlende und archivierte Serien zurück, ohne Profil oder freie Auswahl zu verändern", async () => {
    const { getActivePresetId, getFreeSelectionSeriesIds, savePreset, setActivePreset } = await import("@/lib/catalog");
    await setActivePreset(userId, null, [seriesIds[0]]);
    const presetId = await savePreset(userId, { name: "Profil", seriesIds: [seriesIds[0]] });
    await pool.query("UPDATE series SET archived=true WHERE id=$1", [seriesIds[1]]);
    await expect(setActivePreset(userId, null, [seriesIds[0], seriesIds[1]])).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    await expect(setActivePreset(userId, null, [randomUUID()])).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    await expect(setActivePreset(userId, presetId, [seriesIds[0]])).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    expect(await getActivePresetId(userId)).toBe(presetId);
    expect(await getFreeSelectionSeriesIds(userId)).toEqual([seriesIds[0]]);
  });
});
