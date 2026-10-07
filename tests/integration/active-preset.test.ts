import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Persistente Preset-Auswahl", () => {
  let pool: Pool;
  let userId: string;
  let otherUserId: string;
  let seriesId: string;

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
       VALUES ($1, 'x', current_date), ($2, 'x', current_date)
       RETURNING id`,
      [`preset-${suffix}@example.org`, `other-preset-${suffix}@example.org`],
    );
    [userId, otherUserId] = users.rows.map((row) => row.id);
    seriesId = (await pool.query<{ id: string }>(
      "INSERT INTO series (series_key, name) VALUES ($1, 'Preset-Serie') RETURNING id",
      [`preset-${suffix}`],
    )).rows[0].id;
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  it("startet ohne Preset und speichert neue Presets getrennt pro Account", async () => {
    const { getActivePresetId, savePreset } = await import("@/lib/catalog");
    expect(await getActivePresetId(userId)).toBeNull();
    expect(await getActivePresetId(otherUserId)).toBeNull();

    const presetId = await savePreset(userId, { name: "Mein Profil", seriesIds: [seriesId] });
    expect(await getActivePresetId(userId)).toBe(presetId);
    expect(await getActivePresetId(otherUserId)).toBeNull();
    expect((await pool.query("SELECT active_preset_id FROM users WHERE id=$1", [userId])).rows[0].active_preset_id).toBe(presetId);

    const otherPresetId = await savePreset(otherUserId, { name: "Mein Profil", seriesIds: [seriesId] });
    expect(await getActivePresetId(otherUserId)).toBe(otherPresetId);
    expect(await getActivePresetId(userId)).toBe(presetId);
  });

  it("merkt einen Wechsel und die Rückkehr zur freien Auswahl", async () => {
    const { getActivePresetId, savePreset, setActivePreset } = await import("@/lib/catalog");
    const first = await savePreset(userId, { name: "Erstes Profil", seriesIds: [seriesId] });
    const second = await savePreset(userId, { name: "Zweites Profil", seriesIds: [seriesId] });
    expect(await getActivePresetId(userId)).toBe(second);

    await setActivePreset(userId, first);
    expect(await getActivePresetId(userId)).toBe(first);
    await savePreset(userId, { name: "Zweites Profil bearbeitet", seriesIds: [seriesId] }, second);
    expect(await getActivePresetId(userId)).toBe(first);

    await setActivePreset(userId, null);
    expect(await getActivePresetId(userId)).toBeNull();
    expect((await pool.query("SELECT active_preset_id FROM users WHERE id=$1", [userId])).rows[0].active_preset_id).toBeNull();
  });

  it("setzt ein gelöschtes aktives Preset zurück und erhält die Auswahl bei anderer Löschung", async () => {
    const { deletePreset, getActivePresetId, savePreset } = await import("@/lib/catalog");
    const first = await savePreset(userId, { name: "Altes Profil", seriesIds: [seriesId] });
    const second = await savePreset(userId, { name: "Aktuelles Profil", seriesIds: [seriesId] });
    await deletePreset(userId, first);
    expect(await getActivePresetId(userId)).toBe(second);

    await deletePreset(userId, second);
    expect(await getActivePresetId(userId)).toBeNull();
    expect((await pool.query("SELECT active_preset_id FROM users WHERE id=$1", [userId])).rows[0].active_preset_id).toBeNull();
  });

  it("weist fremde und fehlende Presets zurück, ohne die gespeicherte Auswahl zu ändern", async () => {
    const { getActivePresetId, savePreset, setActivePreset } = await import("@/lib/catalog");
    const own = await savePreset(userId, { name: "Eigenes Profil", seriesIds: [seriesId] });
    const foreign = await savePreset(otherUserId, { name: "Fremdes Profil", seriesIds: [seriesId] });

    await expect(setActivePreset(userId, foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setActivePreset(userId, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getActivePresetId(userId)).toBe(own);
    expect(await getActivePresetId(otherUserId)).toBe(foreign);
  });

  it("aktiviert ein neues Preset erst nach erfolgreichem Speichern aller Serien", async () => {
    const { getActivePresetId, getPresets, savePreset } = await import("@/lib/catalog");
    const original = await savePreset(userId, { name: "Bestehendes Profil", seriesIds: [seriesId] });
    await expect(savePreset(userId, { name: "Fehlerhaftes Profil", seriesIds: [randomUUID()] })).rejects.toMatchObject({ code: "23503" });
    expect(await getActivePresetId(userId)).toBe(original);
    expect(await getPresets(userId)).toEqual([{ id: original, name: "Bestehendes Profil", seriesIds: [seriesId] }]);
  });
});
