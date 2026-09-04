import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("atomarer Zufallsgenerator mit PostgreSQL", () => {
  let pool: Pool;
  let userId: string;
  let seriesId: string;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (!parsed.pathname.toLowerCase().includes("test")) throw new Error("TEST_DATABASE_URL muss auf eine Testdatenbank zeigen.");
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_SECRET = "integration-test-secret-with-more-than-32-bytes";
    process.env.SETUP_TOKEN = "test-setup";
    process.env.TZ = "Europe/Berlin";
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query(await readFile(resolve("migrations/0001_initial.sql"), "utf8"));
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users (email,password_hash,role,catalog_baseline_date) VALUES ('test@example.com','x','owner',current_date) RETURNING id",
    );
    userId = user.rows[0].id;
    const series = await pool.query<{ id: string }>(
      "INSERT INTO series (series_key,name) VALUES ('testserie','Testserie') RETURNING id",
    );
    seriesId = series.rows[0].id;
    await pool.query(
      `INSERT INTO episodes (series_id,episode_key,title,release_date,priority_on_release,duration_minutes)
       VALUES ($1,'normal','Normale Folge',current_date,false,50),
              ($1,'neu','Neue Folge',current_date,true,60)`,
      [seriesId],
    );
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  it("liefert bei parallelen Anfragen genau eine aktive Ziehung", async () => {
    const { drawEpisode } = await import("@/lib/randomizer");
    const draws = await Promise.all(Array.from({ length: 20 }, () => drawEpisode(userId, { seriesIds: [seriesId] })));
    expect(new Set(draws.map((draw) => draw.id)).size).toBe(1);
    expect(draws[0].episode.episodeKey).toBe("neu");
    expect(draws[0].wasPriority).toBe(true);
  });

  it("nimmt eine übersprungene Neuerscheinung aus der Priorität, aber nicht aus der Runde", async () => {
    const { drawEpisode, getCurrentDraw, resolveDraw } = await import("@/lib/randomizer");
    const current = await getCurrentDraw(userId);
    await resolveDraw(userId, current!.id, "skipped");
    const next = await drawEpisode(userId, { seriesIds: [seriesId] });
    expect(next.episode.episodeKey).toBe("normal");
    await resolveDraw(userId, next.id, "heard");
    const later = await drawEpisode(userId, { seriesIds: [seriesId] });
    expect(later.episode.episodeKey).toBe("neu");
  });

  it("hält gehörte Folgen bis zum expliziten Rundenreset zurück", async () => {
    const { drawEpisode, resolveDraw, resetRounds } = await import("@/lib/randomizer");
    const active = await drawEpisode(userId, { seriesIds: [seriesId] });
    await resolveDraw(userId, active.id, "heard");
    await expect(drawEpisode(userId, { seriesIds: [seriesId] })).rejects.toMatchObject({ code: "EMPTY_POOL" });
    await resetRounds(userId, [seriesId]);
    const fresh = await drawEpisode(userId, { seriesIds: [seriesId] });
    expect(fresh.roundNumber).toBe(2);
  });

  it("erhält den Verlauf und rechnet eine Rücknahme aus den Statistiken heraus", async () => {
    const { getAnalytics } = await import("@/lib/analytics");
    const { getSeriesOverview } = await import("@/lib/catalog");
    const { getCurrentDraw, getHistory, resolveDraw, restoreHeardDraw } = await import("@/lib/randomizer");
    const active = await getCurrentDraw(userId);
    expect(active).not.toBeNull();
    await resolveDraw(userId, active!.id, "heard");

    const historyBefore = await getHistory(userId);
    const itemBefore = historyBefore.find((item) => item.id === active!.id);
    expect(itemBefore).toMatchObject({ status: "heard", canRestore: true });
    const analyticsBefore = await getAnalytics(userId, "2000-01-01", "2100-01-01");
    expect(analyticsBefore.heard).toBeGreaterThan(0);

    await Promise.all([restoreHeardDraw(userId, active!.id), restoreHeardDraw(userId, active!.id)]);
    const historyAfter = await getHistory(userId);
    const itemAfter = historyAfter.find((item) => item.id === active!.id);
    expect(itemAfter?.canRestore).toBe(false);
    expect(itemAfter?.correctedAt).not.toBeNull();

    const analyticsAfter = await getAnalytics(userId, "2000-01-01", "2100-01-01");
    expect(analyticsAfter.heard).toBe(analyticsBefore.heard - 1);
    const overview = await getSeriesOverview(userId);
    expect(overview.find((series) => series.id === seriesId)?.remainingCount).toBe(2);
  });
});
