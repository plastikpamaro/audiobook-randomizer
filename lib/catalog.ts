import "server-only";

import type { PoolClient } from "pg";
import { db, lockUser, query, transaction } from "@/lib/db";
import { isoDate, localDate } from "@/lib/dates";
import { AppError } from "@/lib/http";
import type { EpisodeLink, EpisodeSummary, Preset, SeriesOverview } from "@/lib/types";
import type { z } from "zod";
import type { episodeInputSchema, presetInputSchema, seriesInputSchema } from "@/lib/validation";

type SeriesInput = z.infer<typeof seriesInputSchema>;
type EpisodeInput = z.infer<typeof episodeInputSchema>;
type PresetInput = z.infer<typeof presetInputSchema>;

interface SeriesRow {
  id: string;
  series_key: string;
  name: string;
  description: string | null;
  accent_color: string;
  archived: boolean;
  round_number: number | string;
  total_count: number | string;
  remaining_count: number | string;
  heard_count: number | string;
  future_count: number | string;
}

function mapSeries(row: SeriesRow): SeriesOverview {
  return {
    id: row.id,
    seriesKey: row.series_key,
    name: row.name,
    description: row.description || "",
    accentColor: row.accent_color,
    archived: row.archived,
    roundNumber: Number(row.round_number),
    totalCount: Number(row.total_count),
    remainingCount: Number(row.remaining_count),
    heardCount: Number(row.heard_count),
    futureCount: Number(row.future_count),
  };
}

export async function getSeriesOverview(userId: string, includeArchived = false): Promise<SeriesOverview[]> {
  const rows = await query<SeriesRow>(
    `SELECT s.id, s.series_key, s.name, s.description, s.accent_color, s.archived,
            COALESCE(usr.round_number, 1) AS round_number,
            count(e.id) FILTER (
              WHERE e.archived = false AND (e.release_date IS NULL OR e.release_date <= $2::date)
            ) AS total_count,
            count(e.id) FILTER (
              WHERE e.archived = false
                AND (e.release_date IS NULL OR e.release_date <= $2::date)
                AND ec.id IS NULL
            ) AS remaining_count,
            count(e.id) FILTER (
              WHERE e.archived = false
                AND (e.release_date IS NULL OR e.release_date <= $2::date)
                AND ec.id IS NOT NULL
            ) AS heard_count,
            count(e.id) FILTER (WHERE e.archived = false AND e.release_date > $2::date) AS future_count
     FROM series s
     LEFT JOIN user_series_rounds usr ON usr.series_id = s.id AND usr.user_id = $1
     LEFT JOIN episodes e ON e.series_id = s.id
     LEFT JOIN episode_completions ec
       ON ec.episode_id = e.id
      AND ec.user_id = $1
      AND ec.round_number = COALESCE(usr.round_number, 1)
      AND ec.reversed_at IS NULL
     WHERE ($3::boolean = true OR s.archived = false)
     GROUP BY s.id, usr.round_number
     ORDER BY lower(s.name)`,
    [userId, localDate(), includeArchived],
  );
  return rows.map(mapSeries);
}

interface EpisodeRow {
  id: string;
  episode_key: string;
  series_id: string;
  series_name: string;
  series_key: string;
  accent_color: string;
  title: string;
  number_label: string | null;
  sort_order: number | null;
  release_date: string | Date | null;
  duration_minutes: number | null;
  priority_on_release: boolean;
  archived: boolean;
  series_archived: boolean;
  favorite: boolean | null;
  note: string | null;
  round_number: number | string;
  completion_id: string | null;
  rating_average?: number | string | null;
  rating_count?: number | string;
  links: EpisodeLink[] | string | null;
}

export function mapEpisode(row: EpisodeRow, today = localDate()): EpisodeSummary {
  const releaseDate = isoDate(row.release_date);
  let status: EpisodeSummary["status"] = "available";
  if (row.archived || row.series_archived) status = "archived";
  else if (releaseDate && releaseDate > today) status = "future";
  else if (row.completion_id) status = "heard";
  const links = typeof row.links === "string" ? JSON.parse(row.links) : row.links;

  return {
    id: row.id,
    episodeKey: row.episode_key,
    seriesId: row.series_id,
    seriesName: row.series_name,
    seriesKey: row.series_key,
    accentColor: row.accent_color,
    title: row.title,
    numberLabel: row.number_label,
    sortOrder: row.sort_order,
    releaseDate,
    durationMinutes: row.duration_minutes,
    priorityOnRelease: row.priority_on_release,
    archived: row.archived,
    favorite: row.favorite ?? false,
    note: row.note || "",
    ratingAverage: row.rating_average == null ? null : Number(row.rating_average),
    ratingCount: Number(row.rating_count || 0),
    status,
    roundNumber: Number(row.round_number),
    links: (links || []).map((link: Record<string, unknown>) => ({
      id: String(link.id),
      label: String(link.label),
      url: String(link.url),
      sortOrder: Number(link.sortOrder ?? link.sort_order ?? 0),
    })),
  };
}

export async function getEpisodes(userId: string): Promise<EpisodeSummary[]> {
  const rows = await query<EpisodeRow>(
    `SELECT e.id, e.episode_key, e.series_id, s.name AS series_name, s.series_key,
            s.accent_color, s.archived AS series_archived, e.title, e.number_label,
            e.sort_order, e.release_date, e.duration_minutes, e.priority_on_release,
            e.archived, uep.favorite, uep.note,
            COALESCE(usr.round_number, 1) AS round_number,
            ec.id AS completion_id,
            ratings.rating_average, COALESCE(ratings.rating_count, 0) AS rating_count,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', el.id, 'label', el.label, 'url', el.url, 'sortOrder', el.sort_order
              ) ORDER BY el.sort_order, lower(el.label))
              FROM episode_links el WHERE el.episode_id = e.id
            ), '[]'::json) AS links
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     LEFT JOIN user_series_rounds usr ON usr.user_id = $1 AND usr.series_id = s.id
     LEFT JOIN episode_completions ec
       ON ec.user_id = $1
      AND ec.episode_id = e.id
      AND ec.round_number = COALESCE(usr.round_number, 1)
      AND ec.reversed_at IS NULL
     LEFT JOIN user_episode_preferences uep ON uep.user_id = $1 AND uep.episode_id = e.id
     LEFT JOIN LATERAL (
       SELECT round(avg(c.rating)::numeric, 1) AS rating_average, count(c.rating) AS rating_count
       FROM episode_completions c
       WHERE c.user_id=$1 AND c.episode_id=e.id AND c.source_type='random'
         AND c.reversed_at IS NULL AND c.rating IS NOT NULL
     ) ratings ON true
     ORDER BY lower(s.name), e.sort_order NULLS LAST, e.release_date NULLS LAST,
              e.number_label NULLS LAST, lower(e.title)`,
    [userId],
  );
  return rows.map((row) => mapEpisode(row));
}

export async function getPresets(userId: string): Promise<Preset[]> {
  const rows = await query<{ id: string; name: string; series_ids: string[] | null }>(
    `SELECT p.id, p.name, array_agg(ps.series_id ORDER BY ps.series_id)
       FILTER (WHERE ps.series_id IS NOT NULL) AS series_ids
     FROM presets p
     LEFT JOIN preset_series ps ON ps.preset_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY lower(p.name)`,
    [userId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, seriesIds: row.series_ids || [] }));
}

export async function createSeries(input: SeriesInput): Promise<string> {
  const result = await db().query<{ id: string }>(
    `INSERT INTO series (series_key, name, description, accent_color, archived)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.seriesKey, input.name, input.description || null, input.accentColor, input.archived],
  );
  return result.rows[0].id;
}

export async function updateSeries(id: string, input: Partial<SeriesInput>): Promise<void> {
  const result = await db().query(
    `UPDATE series SET
       series_key = COALESCE($2, series_key),
       name = COALESCE($3, name),
       description = CASE WHEN $4::boolean THEN $5 ELSE description END,
       accent_color = COALESCE($6, accent_color),
       archived = COALESCE($7, archived),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      input.seriesKey ?? null,
      input.name ?? null,
      Object.hasOwn(input, "description"),
      input.description || null,
      input.accentColor ?? null,
      input.archived ?? null,
    ],
  );
  if (!result.rowCount) throw new AppError("Serie nicht gefunden.", 404, "NOT_FOUND");
}

async function replaceLinks(client: PoolClient, episodeId: string, links: EpisodeInput["links"]): Promise<void> {
  await client.query("DELETE FROM episode_links WHERE episode_id = $1", [episodeId]);
  for (const link of links) {
    await client.query(
      `INSERT INTO episode_links (episode_id, label, url, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [episodeId, link.label, link.url, link.sortOrder],
    );
  }
}

export async function createEpisode(input: EpisodeInput): Promise<string> {
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO episodes (
         series_id, episode_key, number_label, sort_order, title, release_date,
         duration_minutes, priority_on_release, archived
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        input.seriesId,
        input.episodeKey,
        input.numberLabel || null,
        input.sortOrder ?? null,
        input.title,
        input.releaseDate ?? null,
        input.durationMinutes ?? null,
        input.priorityOnRelease,
        input.archived,
      ],
    );
    await replaceLinks(client, result.rows[0].id, input.links);
    return result.rows[0].id;
  });
}

export async function updateEpisode(id: string, input: EpisodeInput): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query(
      `UPDATE episodes SET series_id=$2, episode_key=$3, number_label=$4, sort_order=$5,
         title=$6, release_date=$7, duration_minutes=$8, priority_on_release=$9,
         archived=$10, updated_at=now()
       WHERE id=$1`,
      [
        id,
        input.seriesId,
        input.episodeKey,
        input.numberLabel || null,
        input.sortOrder ?? null,
        input.title,
        input.releaseDate ?? null,
        input.durationMinutes ?? null,
        input.priorityOnRelease,
        input.archived,
      ],
    );
    if (!result.rowCount) throw new AppError("Folge nicht gefunden.", 404, "NOT_FOUND");
    await replaceLinks(client, id, input.links);
  });
}

export async function setEpisodeArchived(id: string, archived: boolean): Promise<void> {
  const result = await db().query(
    "UPDATE episodes SET archived=$2, updated_at=now() WHERE id=$1",
    [id, archived],
  );
  if (!result.rowCount) throw new AppError("Folge nicht gefunden.", 404, "NOT_FOUND");
}

export async function getEpisodeLinks(episodeId: string): Promise<EpisodeLink[]> {
  const rows = await query<{ id: string; label: string; url: string; sort_order: number }>(
    `SELECT id, label, url, sort_order
     FROM episode_links WHERE episode_id=$1 ORDER BY sort_order, lower(label)`,
    [episodeId],
  );
  return rows.map((row) => ({ id: row.id, label: row.label, url: row.url, sortOrder: row.sort_order }));
}

export async function createEpisodeLink(input: {
  episodeId: string;
  label: string;
  url: string;
  sortOrder: number;
}): Promise<string> {
  const result = await db().query<{ id: string }>(
    `INSERT INTO episode_links (episode_id, label, url, sort_order)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.episodeId, input.label, input.url, input.sortOrder],
  );
  return result.rows[0].id;
}

export async function updateEpisodeLink(id: string, input: {
  episodeId: string;
  label: string;
  url: string;
  sortOrder: number;
}): Promise<void> {
  const result = await db().query(
    `UPDATE episode_links SET episode_id=$2, label=$3, url=$4, sort_order=$5 WHERE id=$1`,
    [id, input.episodeId, input.label, input.url, input.sortOrder],
  );
  if (!result.rowCount) throw new AppError("Hörlink nicht gefunden.", 404, "NOT_FOUND");
}

export async function deleteEpisodeLink(id: string): Promise<void> {
  const result = await db().query("DELETE FROM episode_links WHERE id=$1", [id]);
  if (!result.rowCount) throw new AppError("Hörlink nicht gefunden.", 404, "NOT_FOUND");
}

export async function upsertPreference(
  userId: string,
  episodeId: string,
  input: { favorite?: boolean; note?: string },
): Promise<void> {
  await db().query(
    `INSERT INTO user_episode_preferences (user_id, episode_id, favorite, note)
     VALUES ($1, $2, COALESCE($3, false), $4)
     ON CONFLICT (user_id, episode_id) DO UPDATE SET
       favorite = COALESCE($3, user_episode_preferences.favorite),
       note = CASE WHEN $5::boolean THEN $4 ELSE user_episode_preferences.note END,
       updated_at = now()`,
    [userId, episodeId, input.favorite ?? null, input.note ?? null, Object.hasOwn(input, "note")],
  );
}

export async function savePreset(userId: string, input: PresetInput, presetId?: string): Promise<string> {
  return transaction(async (client) => {
    let id = presetId;
    if (id) {
      const updated = await client.query(
        "UPDATE presets SET name=$1, updated_at=now() WHERE id=$2 AND user_id=$3",
        [input.name, id, userId],
      );
      if (!updated.rowCount) throw new AppError("Preset nicht gefunden.", 404, "NOT_FOUND");
      await client.query("DELETE FROM preset_series WHERE preset_id=$1", [id]);
    } else {
      const created = await client.query<{ id: string }>(
        "INSERT INTO presets (user_id, name) VALUES ($1, $2) RETURNING id",
        [userId, input.name],
      );
      id = created.rows[0].id;
    }
    for (const seriesId of [...new Set(input.seriesIds)]) {
      await client.query("INSERT INTO preset_series (preset_id, series_id) VALUES ($1, $2)", [id, seriesId]);
    }
    return id;
  });
}

export async function deletePreset(userId: string, presetId: string): Promise<void> {
  const result = await db().query("DELETE FROM presets WHERE id=$1 AND user_id=$2", [presetId, userId]);
  if (!result.rowCount) throw new AppError("Preset nicht gefunden.", 404, "NOT_FOUND");
}

export async function applyBulkEpisodeAction(
  userId: string,
  episodeIds: string[],
  action: "heard" | "available" | "archive" | "unarchive",
): Promise<void> {
  const ids = [...new Set(episodeIds)];
  if (!ids.length) throw new AppError("Wähle mindestens eine Folge aus.");
  await transaction(async (client) => {
    await lockUser(client, userId);
    const active = await client.query<{ episode_id: string }>(
      "SELECT episode_id FROM draws WHERE user_id=$1 AND status='active' AND episode_id = ANY($2::uuid[])",
      [userId, ids],
    );
    if (active.rowCount) {
      throw new AppError("Die aktive Folge muss zuerst abgeschlossen oder übersprungen werden.", 409, "ACTIVE_EPISODE");
    }

    if (action === "archive" || action === "unarchive") {
      await client.query("UPDATE episodes SET archived=$1, updated_at=now() WHERE id = ANY($2::uuid[])", [
        action === "archive",
        ids,
      ]);
      return;
    }

    const episodes = await client.query<{ id: string; series_id: string; duration_minutes: number | null }>(
      "SELECT id, series_id, duration_minutes FROM episodes WHERE id = ANY($1::uuid[])",
      [ids],
    );
    for (const episode of episodes.rows) {
      const roundResult = await client.query<{ round_number: number }>(
        `SELECT COALESCE((SELECT round_number FROM user_series_rounds WHERE user_id=$1 AND series_id=$2), 1)
           AS round_number`,
        [userId, episode.series_id],
      );
      const round = Number(roundResult.rows[0].round_number);
      if (action === "heard") {
        const existing = await client.query(
          `SELECT 1 FROM episode_completions
           WHERE user_id=$1 AND episode_id=$2 AND round_number=$3 AND reversed_at IS NULL`,
          [userId, episode.id, round],
        );
        if (existing.rowCount) continue;
        const draw = await client.query<{ id: string }>(
          `INSERT INTO draws (
             user_id, episode_id, round_number, status, source_type,
             selection_series_ids, drawn_at, resolved_at
           ) VALUES ($1,$2,$3,'heard','bulk',ARRAY[$4::uuid],now(),now()) RETURNING id`,
          [userId, episode.id, round, episode.series_id],
        );
        await client.query(
          `INSERT INTO episode_completions (
             user_id, episode_id, round_number, draw_id, source_type,
             duration_minutes_snapshot
           ) VALUES ($1,$2,$3,$4,'bulk',$5)`,
          [userId, episode.id, round, draw.rows[0].id, episode.duration_minutes],
        );
      } else {
        const completion = await client.query<{ draw_id: string }>(
          `UPDATE episode_completions SET reversed_at=now()
           WHERE user_id=$1 AND episode_id=$2 AND round_number=$3 AND reversed_at IS NULL
           RETURNING draw_id`,
          [userId, episode.id, round],
        );
        if (completion.rowCount) {
          await client.query("UPDATE draws SET corrected_at=now() WHERE id=$1", [completion.rows[0].draw_id]);
        }
      }
    }
  });
}
