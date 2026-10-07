import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Andere Folge atomar auswählen", () => {
  let pool: Pool;
  let userId: string;
  let otherUserId: string;
  let seriesId: string;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.toLowerCase().includes("test")) throw new Error("Testdatenbank erforderlich.");
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
      [`next-${suffix}@example.org`, `other-next-${suffix}@example.org`],
    );
    [userId, otherUserId] = users.rows.map((row) => row.id);
    seriesId = (await pool.query<{ id: string }>(
      "INSERT INTO series (series_key, name) VALUES ($1, 'Andere Folge') RETURNING id",
      [`next-${suffix}`],
    )).rows[0].id;
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  async function episodes(count: number): Promise<string[]> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO episodes (series_id, episode_key, title)
       SELECT $1, 'folge-' || n, 'Folge ' || n FROM generate_series(1, $2::int) n RETURNING id`,
      [seriesId, count],
    );
    return result.rows.map((row) => row.id);
  }

  async function drawState() {
    return (await pool.query(
      "SELECT id, status, resolved_at, replaced_draw_id FROM draws WHERE user_id=$1 ORDER BY drawn_at, id",
      [userId],
    )).rows;
  }

  it("zieht mit zwei Folgen bei jedem Wechsel eine andere und erhält den Rundenvorrat", async () => {
    const { drawEpisode, skipAndDrawNext, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(2);
    let current = await drawEpisode(userId, { seriesIds: [seriesId] });
    for (let n = 0; n < 10; n++) {
      const previous = current;
      current = await skipAndDrawNext(userId, current.id);
      expect(current.episode.id).not.toBe(previous.episode.id);
      expect(current.selectionSeriesIds).toEqual([seriesId]);
      expect(current.status).toBe("active");
      expect(current.roundNumber).toBe(1);
    }
    expect((await getCurrentDraw(userId))?.id).toBe(current.id);
    const state = await drawState();
    expect(state.filter((draw) => draw.status === "active")).toHaveLength(1);
    expect(state.filter((draw) => draw.status === "skipped")).toHaveLength(10);
    expect((await pool.query("SELECT id FROM episode_completions WHERE user_id=$1", [userId])).rowCount).toBe(0);
  });

  it("behält eine einzelne Folge unverändert und erlaubt den bisherigen normalen Ziehvorgang", async () => {
    const { drawEpisode, skipAndDrawNext, resolveDraw, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(1);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    const before = await drawState();
    await expect(skipAndDrawNext(userId, current.id)).rejects.toMatchObject({ code: "NO_ALTERNATIVE", status: 409 });
    expect(await drawState()).toEqual(before);
    expect((await getCurrentDraw(userId))?.id).toBe(current.id);
    await resolveDraw(userId, current.id, "skipped");
    expect((await drawEpisode(userId, { seriesIds: [seriesId] })).episode.id).toBe(current.episode.id);
  });

  it("ignoriert gehörte, zukünftige und archivierte Alternativen ohne die aktive Folge zu verlieren", async () => {
    const { drawEpisode, skipAndDrawNext, recordManualListen } = await import("@/lib/randomizer");
    const ids = await episodes(4);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    const alternatives = ids.filter((id) => id !== current.episode.id);
    await recordManualListen(userId, { episodeId: alternatives[0], requestId: randomUUID() });
    await pool.query("UPDATE episodes SET release_date='2099-01-01' WHERE id=$1", [alternatives[1]]);
    await pool.query("UPDATE episodes SET archived=true WHERE id=$1", [alternatives[2]]);
    const before = await drawState();
    await expect(skipAndDrawNext(userId, current.id)).rejects.toMatchObject({ code: "NO_ALTERNATIVE" });
    expect(await drawState()).toEqual(before);
    await pool.query("UPDATE series SET archived=true WHERE id=$1", [seriesId]);
    await expect(skipAndDrawNext(userId, current.id)).rejects.toMatchObject({ code: "NO_ALTERNATIVE" });
    expect(await drawState()).toEqual(before);
  });

  it("verwendet den gespeicherten Auswahlstand auch nach einer Profiländerung und Profillöschung", async () => {
    const { drawEpisode, skipAndDrawNext } = await import("@/lib/randomizer");
    const { savePreset, deletePreset } = await import("@/lib/catalog");
    await episodes(2);
    const presetId = await savePreset(userId, { name: "Mein Profil", seriesIds: [seriesId] });
    const current = await drawEpisode(userId, { presetId });
    const unrelatedSeriesId = (await pool.query<{ id: string }>(
      "INSERT INTO series (series_key, name) VALUES ($1, 'Neue Auswahl') RETURNING id", [randomUUID()],
    )).rows[0].id;
    await pool.query("INSERT INTO episodes (series_id, episode_key, title) VALUES ($1,'fremd','Fremde Folge')", [unrelatedSeriesId]);
    await savePreset(userId, { name: "Bearbeitet", seriesIds: [unrelatedSeriesId] }, presetId);
    const next = await skipAndDrawNext(userId, current.id);
    expect(next.presetId).toBe(presetId);
    expect(next.selectionSeriesIds).toEqual([seriesId]);
    expect(next.episode.seriesId).toBe(seriesId);
    await deletePreset(userId, presetId);
    const afterDeletion = await skipAndDrawNext(userId, next.id);
    expect(afterDeletion.presetId).toBeNull();
    expect(afterDeletion.selectionSeriesIds).toEqual([seriesId]);
    expect(afterDeletion.episode.seriesId).toBe(seriesId);
  });

  it("beachtet Neuerscheinungspriorität und bereits gehörte Folgen in der aktuellen Runde", async () => {
    const { drawEpisode, skipAndDrawNext, resolveDraw, recordManualListen } = await import("@/lib/randomizer");
    const ids = await episodes(4);
    await pool.query("INSERT INTO user_series_rounds(user_id,series_id,round_number) VALUES ($1,$2,2)", [userId, seriesId]);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    const alternatives = ids.filter((id) => id !== current.episode.id);
    await pool.query("UPDATE episodes SET priority_on_release=true,release_date=current_date WHERE id=$1", [alternatives[0]]);
    await recordManualListen(userId, { episodeId: alternatives[1], requestId: randomUUID() });
    await recordManualListen(userId, { episodeId: alternatives[2], requestId: randomUUID() });
    const next = await skipAndDrawNext(userId, current.id);
    expect(next.episode.id).toBe(alternatives[0]);
    expect(next.wasPriority).toBe(true);
    expect(next.roundNumber).toBe(2);
    expect((await pool.query("SELECT draw_id FROM episode_priority_offers WHERE user_id=$1 AND episode_id=$2", [userId, next.episode.id])).rows).toEqual([{ draw_id: next.id }]);
    await resolveDraw(userId, next.id, "heard");
    const later = await drawEpisode(userId, { seriesIds: [seriesId] });
    expect(later.episode.id).toBe(current.episode.id);
    expect(later.wasPriority).toBe(false);
  });

  it("reserviert bei parallelen und wiederholten Anfragen nur einen Ersatz", async () => {
    const { drawEpisode, skipAndDrawNext } = await import("@/lib/randomizer");
    await episodes(3);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    const replacements = await Promise.all(Array.from({ length: 20 }, () => skipAndDrawNext(userId, current.id)));
    expect(new Set(replacements.map((draw) => draw.id)).size).toBe(1);
    expect(replacements.every((draw) => draw.episode.id !== current.episode.id)).toBe(true);
    expect((await skipAndDrawNext(userId, current.id)).id).toBe(replacements[0].id);
    const state = await drawState();
    expect(state).toHaveLength(2);
    expect(state.find((draw) => draw.id === current.id)?.status).toBe("skipped");
    expect(state.find((draw) => draw.id === replacements[0].id)).toMatchObject({ status: "active", replaced_draw_id: current.id });
  });

  it("weist fremde, fehlende und anders abgeschlossene Ziehungen zurück", async () => {
    const { drawEpisode, skipAndDrawNext, resolveDraw, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(2);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    await expect(skipAndDrawNext(otherUserId, current.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(skipAndDrawNext(userId, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getCurrentDraw(userId))?.id).toBe(current.id);
    await resolveDraw(userId, current.id, "heard");
    await expect(skipAndDrawNext(userId, current.id)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    const next = await drawEpisode(userId, { seriesIds: [seriesId] });
    await resolveDraw(userId, next.id, "skipped");
    const unrelated = await drawEpisode(userId, { seriesIds: [seriesId] });
    await expect(skipAndDrawNext(userId, next.id)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    expect((await getCurrentDraw(userId))?.id).toBe(unrelated.id);
  });

  it("lässt eine veraltete Anfrage nach einem weiteren Wechsel die aktuelle Ziehung unverändert", async () => {
    const { drawEpisode, skipAndDrawNext, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(3);
    const first = await drawEpisode(userId, { seriesIds: [seriesId] });
    const second = await skipAndDrawNext(userId, first.id);
    const third = await skipAndDrawNext(userId, second.id);
    await expect(skipAndDrawNext(userId, first.id)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    expect((await getCurrentDraw(userId))?.id).toBe(third.id);
    expect(await drawState()).toHaveLength(3);
  });

  it("entscheidet bei gleichzeitigem Gehört-Abschluss und Wechsel genau einen Vorgang", async () => {
    const { drawEpisode, skipAndDrawNext, resolveDraw, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(2);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    const results = await Promise.allSettled([
      skipAndDrawNext(userId, current.id),
      resolveDraw(userId, current.id, "heard"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "ALREADY_RESOLVED" });
    if (results[0].status === "fulfilled") {
      expect((await getCurrentDraw(userId))?.id).toBe(results[0].value.id);
    } else {
      expect(await getCurrentDraw(userId)).toBeNull();
    }
  });

  it("rollt das Überspringen zurück, wenn das Reservieren des Ersatzes fehlschlägt", async () => {
    const { drawEpisode, skipAndDrawNext, getCurrentDraw } = await import("@/lib/randomizer");
    await episodes(2);
    const current = await drawEpisode(userId, { seriesIds: [seriesId] });
    await pool.query(`CREATE FUNCTION reject_next_draw() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.replaced_draw_id IS NOT NULL THEN RAISE EXCEPTION 'Ersatz fehlgeschlagen'; END IF;
        RETURN NEW;
      END
    $$`);
    await pool.query("CREATE TRIGGER reject_next_draw BEFORE INSERT ON draws FOR EACH ROW EXECUTE FUNCTION reject_next_draw()");
    const before = await drawState();
    try {
      await expect(skipAndDrawNext(userId, current.id)).rejects.toThrow("Ersatz fehlgeschlagen");
      expect(await drawState()).toEqual(before);
      expect((await getCurrentDraw(userId))?.id).toBe(current.id);
    } finally {
      await pool.query("DROP TRIGGER reject_next_draw ON draws");
      await pool.query("DROP FUNCTION reject_next_draw()");
    }
  });
});
