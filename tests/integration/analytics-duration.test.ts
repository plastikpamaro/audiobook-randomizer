import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Nachgetragene Laufzeiten in alten Statistiken", () => {
  let pool: Pool;
  let userId: string;
  let seriesId: string;
  let episodeId: string;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.includes("test")) throw new Error("Testdatenbank erforderlich");
    process.env.DATABASE_URL = url;
    process.env.TZ = "Europe/Berlin";
    pool = new Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) await pool.query(await readFile(`migrations/${file}`, "utf8"));
    userId = (await pool.query("INSERT INTO users(email,password_hash,catalog_baseline_date) VALUES ('duration@example.org','x',current_date) RETURNING id")).rows[0].id;
    const otherUserId = (await pool.query("INSERT INTO users(email,password_hash,catalog_baseline_date) VALUES ('other@example.org','x',current_date) RETURNING id")).rows[0].id;
    seriesId = (await pool.query("INSERT INTO series(series_key,name) VALUES ('duration','Laufzeiten') RETURNING id")).rows[0].id;
    episodeId = (await pool.query("INSERT INTO episodes(series_id,episode_key,title) VALUES ($1,'late','Laufzeit nachtragen') RETURNING id", [seriesId])).rows[0].id;
    const unknownId = (await pool.query("INSERT INTO episodes(series_id,episode_key,title) VALUES ($1,'unknown','Weiterhin unbekannt') RETURNING id", [seriesId])).rows[0].id;
    const entries = [
      { user: userId, episode: episodeId, round: 1, day: "2026-09-04", minutes: null, type: "random", reversed: false },
      { user: userId, episode: episodeId, round: 2, day: "2026-09-04", minutes: null, type: "random", reversed: false },
      { user: userId, episode: episodeId, round: 3, day: "2026-09-06", minutes: 45, type: "random", reversed: false },
      { user: userId, episode: unknownId, round: 1, day: "2026-09-06", minutes: null, type: "random", reversed: false },
      { user: userId, episode: episodeId, round: 4, day: "2026-09-04", minutes: null, type: "bulk", reversed: false },
      { user: userId, episode: episodeId, round: 5, day: "2026-09-04", minutes: null, type: "random", reversed: true },
      { user: otherUserId, episode: episodeId, round: 1, day: "2026-09-04", minutes: null, type: "random", reversed: false },
    ];
    for (const entry of entries) {
      const drawId = (await pool.query("INSERT INTO draws(user_id,episode_id,round_number,status,source_type,selection_series_ids,resolved_at) VALUES ($1,$2,$3,'heard',$4,ARRAY[$5::uuid],$6::timestamptz) RETURNING id", [entry.user, entry.episode, entry.round, entry.type, seriesId, `${entry.day}T12:00:00Z`])).rows[0].id;
      await pool.query("INSERT INTO episode_completions(user_id,episode_id,round_number,draw_id,source_type,completed_at,duration_minutes_snapshot,reversed_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,CASE WHEN $8 THEN now() ELSE NULL END)", [entry.user, entry.episode, entry.round, drawId, entry.type, `${entry.day}T12:00:00Z`, entry.minutes, entry.reversed]);
    }
  });
  afterAll(async () => { const { db } = await import("@/lib/db"); await db().end(); await pool.end(); });

  it("ergänzt Gesamtzeit, Tagesdiagramm und Serienzeit für jeden früheren Durchlauf", async () => {
    const { getAnalytics } = await import("@/lib/analytics");
    const before = await getAnalytics(userId, "2026-09-04", "2026-09-06");
    expect(before.minutes).toBe(45);
    const { updateEpisode } = await import("@/lib/catalog");
    const { episodeInputSchema } = await import("@/lib/validation");
    await updateEpisode(episodeId, episodeInputSchema.parse({ seriesId, episodeKey: "late", title: "Laufzeit nachtragen", durationMinutes: 60, links: [] }));
    const after = await getAnalytics(userId, "2026-09-04", "2026-09-06");
    expect(after.heard).toBe(4);
    expect(after.minutes).toBe(165);
    expect(after.activity).toEqual([
      { bucket: "2026-09-04", heard: 2, skipped: 0, minutes: 120 },
      { bucket: "2026-09-05", heard: 0, skipped: 0, minutes: 0 },
      { bucket: "2026-09-06", heard: 2, skipped: 0, minutes: 45 },
    ]);
    expect(after.topSeries).toEqual([{ name: "Laufzeiten", heard: 4, minutes: 165 }]);
    expect((await getAnalytics(userId, "2026-09-04", "2026-09-04")).minutes).toBe(120);
    expect((await getAnalytics(userId, "2026-09-06", "2026-09-06")).minutes).toBe(45);
    expect((await pool.query("SELECT duration_minutes_snapshot FROM episode_completions WHERE user_id=$1 AND episode_id=$2 AND round_number=3", [userId, episodeId])).rows[0].duration_minutes_snapshot).toBe(45);
  });

  it("ordnet drei Abschlüsse und einen Skip dem 07.09. in Berlin zu, auch vor UTC-Mitternacht", async () => {
    const { getAnalytics } = await import("@/lib/analytics");
    const timestamps = ["2026-09-06T22:15:00Z", "2026-09-07T08:00:00Z", "2026-09-07T14:00:00Z", "2026-09-06T22:30:00Z"];
    for (const [index, timestamp] of timestamps.entries()) {
      const status = index === 3 ? "skipped" : "heard";
      const draw = (await pool.query("INSERT INTO draws(user_id,episode_id,round_number,status,selection_series_ids,resolved_at) VALUES ($1,$2,$3,$4,ARRAY[$5::uuid],$6::timestamptz) RETURNING id", [userId, episodeId, index + 10, status, seriesId, timestamp])).rows[0];
      if (status === "heard") await pool.query("INSERT INTO episode_completions(user_id,episode_id,round_number,draw_id,source_type,completed_at) VALUES ($1,$2,$3,$4,'random',$5::timestamptz)", [userId, episodeId, index + 10, draw.id, timestamp]);
    }
    const analytics = await getAnalytics(userId, "2026-09-07", "2026-09-07");
    expect(analytics.heard).toBe(3);
    expect(analytics.skipped).toBe(1);
    expect(analytics.activity).toEqual([{ bucket: "2026-09-07", heard: 3, skipped: 1, minutes: 180 }]);
    expect(analytics.longestStreak).toBe(2);
    expect((await getAnalytics(userId, "2026-09-06", "2026-09-06")).heard).toBe(2);
  });
});
