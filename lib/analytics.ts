import "server-only";

import { getSeriesOverview } from "@/lib/catalog";
import { query } from "@/lib/db";
import { isoDate, localDate } from "@/lib/dates";
import { getAppTimezone } from "@/lib/env";
import { AppError } from "@/lib/http";
import { computeStreaks } from "@/lib/stats";
import type { ActivityPoint, AnalyticsData } from "@/lib/types";

function assertDateRange(from: string, to: string): void {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(from) || !valid(to) || from > to) {
    throw new AppError("Der Statistikzeitraum ist ungültig.");
  }
}

export async function getAnalytics(userId: string, from: string, to: string): Promise<AnalyticsData> {
  assertDateRange(from, to);
  const timeZone = getAppTimezone();
  const [totalsRows, activityRows, topSeriesRows, streakRows, progress, distributionRows, topRatedEpisodeRows, topRatedSeriesRows] = await Promise.all([
    query<{ heard: string; skipped: string; minutes: string; rating_average: string | null; rated_count: string }>(
      `SELECT
         (SELECT count(*) FROM episode_completions c
          WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL
            AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date)::text AS heard,
         (SELECT count(*) FROM draws d
          WHERE d.user_id=$1 AND d.source_type='random' AND d.status='skipped'
            AND timezone($4, d.resolved_at)::date BETWEEN $2::date AND $3::date)::text AS skipped,
         (SELECT COALESCE(sum(c.duration_minutes_snapshot), 0) FROM episode_completions c
          WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL
            AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date)::text AS minutes,
         (SELECT round(avg(c.rating)::numeric, 2) FROM episode_completions c
          WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL AND c.rating IS NOT NULL
            AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date)::text AS rating_average,
         (SELECT count(c.rating) FROM episode_completions c
          WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL
            AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date)::text AS rated_count`,
      [userId, from, to, timeZone],
    ),
    query<{ bucket: string | Date; heard: string; skipped: string; minutes: string }>(
      `WITH events AS (
         SELECT timezone($4, c.completed_at)::date AS bucket, 1 AS heard, 0 AS skipped,
                COALESCE(c.duration_minutes_snapshot, 0) AS minutes
         FROM episode_completions c
         WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL
           AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT timezone($4, d.resolved_at)::date AS bucket, 0, 1, 0
         FROM draws d
         WHERE d.user_id=$1 AND d.source_type='random' AND d.status='skipped'
           AND timezone($4, d.resolved_at)::date BETWEEN $2::date AND $3::date
       )
       SELECT bucket, sum(heard)::text AS heard, sum(skipped)::text AS skipped,
              sum(minutes)::text AS minutes
       FROM events GROUP BY bucket ORDER BY bucket`,
      [userId, from, to, timeZone],
    ),
    query<{ name: string; heard: string; minutes: string }>(
      `SELECT s.name, count(*)::text AS heard,
              COALESCE(sum(c.duration_minutes_snapshot),0)::text AS minutes
       FROM episode_completions c
       JOIN episodes e ON e.id=c.episode_id JOIN series s ON s.id=e.series_id
       WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL
         AND timezone($4, c.completed_at)::date BETWEEN $2::date AND $3::date
       GROUP BY s.id ORDER BY count(*) DESC, lower(s.name) LIMIT 10`,
      [userId, from, to, timeZone],
    ),
    query<{ day: string | Date }>(
      `SELECT DISTINCT timezone($2, completed_at)::date AS day
       FROM episode_completions
       WHERE user_id=$1 AND source_type='random' AND reversed_at IS NULL
       ORDER BY day`,
      [userId, timeZone],
    ),
    getSeriesOverview(userId),
    query<{ score: number; count: string }>(
      `SELECT scores.score, count(c.rating)::text AS count
       FROM generate_series(1,10) scores(score)
       LEFT JOIN episode_completions c ON c.rating=scores.score AND c.user_id=$1
         AND c.source_type='random' AND c.reversed_at IS NULL
         AND timezone($4,c.completed_at)::date BETWEEN $2::date AND $3::date
       GROUP BY scores.score ORDER BY scores.score`,
      [userId, from, to, timeZone],
    ),
    query<{ title: string; series_name: string; average: string; count: string }>(
      `SELECT e.title, s.name AS series_name, round(avg(c.rating)::numeric,2)::text AS average,
              count(c.rating)::text AS count
       FROM episode_completions c JOIN episodes e ON e.id=c.episode_id JOIN series s ON s.id=e.series_id
       WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL AND c.rating IS NOT NULL
         AND timezone($4,c.completed_at)::date BETWEEN $2::date AND $3::date
       GROUP BY e.id,s.id ORDER BY avg(c.rating) DESC,count(c.rating) DESC,lower(e.title) LIMIT 10`,
      [userId, from, to, timeZone],
    ),
    query<{ name: string; average: string; count: string }>(
      `SELECT s.name, round(avg(c.rating)::numeric,2)::text AS average, count(c.rating)::text AS count
       FROM episode_completions c JOIN episodes e ON e.id=c.episode_id JOIN series s ON s.id=e.series_id
       WHERE c.user_id=$1 AND c.source_type='random' AND c.reversed_at IS NULL AND c.rating IS NOT NULL
         AND timezone($4,c.completed_at)::date BETWEEN $2::date AND $3::date
       GROUP BY s.id ORDER BY avg(c.rating) DESC,count(c.rating) DESC,lower(s.name) LIMIT 10`,
      [userId, from, to, timeZone],
    ),
  ]);

  const totals = totalsRows[0] || { heard: "0", skipped: "0", minutes: "0", rating_average: null, rated_count: "0" };
  const heard = Number(totals.heard);
  const skipped = Number(totals.skipped);
  const streakDays = streakRows.map((row) => isoDate(row.day)!);
  const streaks = computeStreaks(streakDays, localDate());
  const activity: ActivityPoint[] = activityRows.map((row) => ({
    bucket: isoDate(row.bucket)!,
    heard: Number(row.heard),
    skipped: Number(row.skipped),
    minutes: Number(row.minutes),
  }));

  return {
    range: { from, to },
    heard,
    skipped,
    skipRate: heard + skipped ? Math.round((skipped / (heard + skipped)) * 1000) / 10 : 0,
    minutes: Number(totals.minutes),
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    activity,
    topSeries: topSeriesRows.map((row) => ({
      name: row.name,
      heard: Number(row.heard),
      minutes: Number(row.minutes),
    })),
    ratingAverage: totals.rating_average == null ? null : Number(totals.rating_average),
    ratedCount: Number(totals.rated_count),
    ratingDistribution: distributionRows.map((row) => ({ score: Number(row.score), count: Number(row.count) })),
    topRatedEpisodes: topRatedEpisodeRows.map((row) => ({
      title: row.title, seriesName: row.series_name, average: Number(row.average), count: Number(row.count),
    })),
    topRatedSeries: topRatedSeriesRows.map((row) => ({
      name: row.name, average: Number(row.average), count: Number(row.count),
    })),
    progress,
  };
}
