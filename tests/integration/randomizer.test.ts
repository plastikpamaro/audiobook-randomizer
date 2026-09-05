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
    await pool.query(await readFile(resolve("migrations/0002_online_imports_and_ratings.sql"), "utf8"));
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

  it("speichert Bewertungen pro echtem Hördurchlauf und sperrt korrigierte Abschlüsse", async () => {
    const { drawEpisode, getCurrentDraw, getHistory, resolveDraw, restoreHeardDraw, setDrawRating } = await import("@/lib/randomizer");
    const active = await getCurrentDraw(userId) || await drawEpisode(userId, { seriesIds: [seriesId] });
    await resolveDraw(userId, active.id, "heard");
    await Promise.all([setDrawRating(userId, active.id, 9), setDrawRating(userId, active.id, 9)]);
    expect((await getHistory(userId)).find((item) => item.id === active.id)?.rating).toBe(9);
    await setDrawRating(userId, active.id, null);
    expect((await getHistory(userId)).find((item) => item.id === active.id)?.rating).toBeNull();
    await setDrawRating(userId, active.id, 8);
    await restoreHeardDraw(userId, active.id);
    await expect(setDrawRating(userId, active.id, 7)).rejects.toMatchObject({ code: "RATING_LOCKED" });
    expect((await getHistory(userId)).find((item) => item.id === active.id)).toMatchObject({ rating: 8, ratingEditable: false });

    const bulkEpisode = await pool.query<{ id: string }>(
      "INSERT INTO episodes (series_id,episode_key,title) VALUES ($1,'bulk-rating','Bulk ohne Bewertung') RETURNING id",
      [seriesId],
    );
    const { applyBulkEpisodeAction } = await import("@/lib/catalog");
    await applyBulkEpisodeAction(userId, [bulkEpisode.rows[0].id], "heard");
    const bulkDraw = await pool.query<{ id: string }>("SELECT id FROM draws WHERE episode_id=$1 AND source_type='bulk'", [bulkEpisode.rows[0].id]);
    await expect(setDrawRating(userId, bulkDraw.rows[0].id, 10)).rejects.toMatchObject({ code: "RATING_NOT_AVAILABLE" });
    const stranger = await pool.query<{ id: string }>(
      "INSERT INTO users (email,password_hash,catalog_baseline_date) VALUES ('stranger@example.com','x',current_date) RETURNING id",
    );
    await expect(setDrawRating(stranger.rows[0].id, active.id, 5)).rejects.toMatchObject({ code: "RATING_NOT_AVAILABLE" });
  });

  it("bestätigt Erstimporte mit manueller Zuordnung transaktional und idempotent", async () => {
    const source = await pool.query<{ id: string }>(
      `INSERT INTO import_sources (created_by_user_id,series_id,kind,name,url)
       VALUES ($1,$2,'json','Integration','https://example.org/feed.json') RETURNING id`,
      [userId, seriesId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO import_runs (source_id,trigger_type,status,fetched_item_count)
       VALUES ($1,'preview','awaiting_confirmation',2) RETURNING id`,
      [source.rows[0].id],
    );
    const candidate = await pool.query<{ id: string }>("SELECT id FROM episodes WHERE series_id=$1 ORDER BY title LIMIT 1", [seriesId]);
    const base = { numberLabel: null, sortOrder: null, releaseDate: null, durationMinutes: null, priorityOnRelease: false, links: [], canonicalUrl: null };
    const createdProposal = await pool.query<{ id: string }>(
      `INSERT INTO import_proposals (source_id,run_id,external_id,proposal_type,payload_hash,source_payload)
       VALUES ($1,$2,'external-new','create',repeat('a',64),$3::jsonb) RETURNING id`,
      [source.rows[0].id, run.rows[0].id, JSON.stringify({ ...base, externalId: "external-new", title: "Importierte Folge" })],
    );
    const linkedProposal = await pool.query<{ id: string }>(
      `INSERT INTO import_proposals (source_id,run_id,external_id,proposal_type,candidate_episode_id,payload_hash,source_payload)
       VALUES ($1,$2,'external-known','link',$3,repeat('b',64),$4::jsonb) RETURNING id`,
      [source.rows[0].id, run.rows[0].id, candidate.rows[0].id, JSON.stringify({ ...base, externalId: "external-known", title: "Bekannte Folge" })],
    );
    const { commitImportPreview } = await import("@/lib/online-import-service");
    const resolutions = [
      { proposalId: createdProposal.rows[0].id, action: "create" as const },
      { proposalId: linkedProposal.rows[0].id, action: "link" as const, episodeId: candidate.rows[0].id },
    ];
    await Promise.all([commitImportPreview(userId, run.rows[0].id, resolutions), commitImportPreview(userId, run.rows[0].id, resolutions)]);
    const mappings = await pool.query("SELECT * FROM import_source_items WHERE source_id=$1", [source.rows[0].id]);
    expect(mappings.rowCount).toBe(2);
    expect((await pool.query("SELECT enabled,first_import_completed_at FROM import_sources WHERE id=$1", [source.rows[0].id])).rows[0]).toMatchObject({ enabled: true });
    expect((await pool.query("SELECT count(*)::int AS count FROM episodes WHERE series_id=$1 AND title='Importierte Folge'", [seriesId])).rows[0].count).toBe(1);
  });

  it("legt sichere Neuerungen an, schlägt Änderungen vor und serialisiert Worker", async () => {
    const existing = await pool.query<{ id: string }>("SELECT id FROM episodes WHERE series_id=$1 ORDER BY created_at LIMIT 1", [seriesId]);
    const source = await pool.query<{ id: string }>(
      `INSERT INTO import_sources (
         created_by_user_id,series_id,kind,name,url,enabled,first_import_completed_at,last_item_count
       ) VALUES ($1,$2,'json','Sync Integration','https://example.org/sync.json',true,'2026-09-01',1) RETURNING id`,
      [userId, seriesId],
    );
    const original = { externalId: "known", title: "Alter Titel", numberLabel: "1", sortOrder: 1, releaseDate: "2024-01-01", durationMinutes: 50, priorityOnRelease: false, links: [], canonicalUrl: null };
    await pool.query(
      `INSERT INTO import_source_items (source_id,external_id,episode_id,payload_hash,source_payload)
       VALUES ($1,'known',$2,repeat('c',64),$3::jsonb)`,
      [source.rows[0].id, existing.rows[0].id, JSON.stringify(original)],
    );
    const changed = { ...original, title: "Neuer Titel", durationMinutes: 55 };
    const fresh = { externalId: "future-new", title: "Künftige Folge", numberLabel: "900", sortOrder: 900, releaseDate: "2030-01-01", durationMinutes: 60, priorityOnRelease: true, links: [{ label: "Web", url: "https://example.org/new" }], canonicalUrl: "https://example.org/new" };
    const fetcher = async () => ({ feed: { episodes: [changed, fresh], issues: [], warnings: [] }, notModified: false, etag: '"v1"', lastModified: null, finalUrl: "https://example.org/sync.json" });
    const { acceptImportProposal, syncImportSource } = await import("@/lib/online-import-service");
    const run = await syncImportSource(source.rows[0].id, "manual", undefined, fetcher);
    expect(run).toMatchObject({ status: "succeeded", newItemCount: 1, changedItemCount: 1 });
    expect((await pool.query("SELECT priority_on_release FROM episodes WHERE series_id=$1 AND title='Künftige Folge'", [seriesId])).rows[0].priority_on_release).toBe(true);
    const proposal = await pool.query<{ id: string }>("SELECT id FROM import_proposals WHERE source_id=$1 AND proposal_type='update' AND status='pending'", [source.rows[0].id]);
    await acceptImportProposal(userId, proposal.rows[0].id);
    expect((await pool.query("SELECT title,duration_minutes FROM episodes WHERE id=$1", [existing.rows[0].id])).rows[0]).toMatchObject({ title: "Neuer Titel", duration_minutes: 55 });

    const slowFetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return fetcher();
    };
    const parallel = await Promise.allSettled([
      syncImportSource(source.rows[0].id, "scheduled", "2099-01-01", slowFetcher),
      syncImportSource(source.rows[0].id, "scheduled", "2099-01-01", slowFetcher),
    ]);
    expect(parallel.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(parallel.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await syncImportSource(source.rows[0].id, "scheduled", "2099-01-01", fetcher)).toBeNull();
  });
});
