import "server-only";

import type { Pool, PoolClient, QueryResultRow } from "pg";
import { db, lockUser, transaction } from "@/lib/db";
import { mapEpisode } from "@/lib/catalog";
import { isoDateTime, localDate } from "@/lib/dates";
import { AppError } from "@/lib/http";
import type { ActiveDraw, HistoryItem } from "@/lib/types";

type Executor = Pick<Pool | PoolClient, "query">;

interface DrawRow extends QueryResultRow {
  id: string;
  status: "active" | "heard" | "skipped";
  source_type: "random" | "bulk";
  drawn_at: Date | string;
  resolved_at: Date | string | null;
  corrected_at: Date | string | null;
  draw_round_number: number;
  preset_id: string | null;
  selection_series_ids: string[];
  episode_id: string;
  episode_key: string;
  series_id: string;
  series_name: string;
  series_key: string;
  accent_color: string;
  title: string;
  number_label: string | null;
  sort_order: number | null;
  release_date: Date | string | null;
  duration_minutes: number | null;
  priority_on_release: boolean;
  archived: boolean;
  series_archived: boolean;
  favorite: boolean | null;
  note: string | null;
  current_round_number: number;
  completion_id: string | null;
  links: unknown;
  can_restore?: boolean;
  was_priority: boolean;
}

const drawSelect = `
  SELECT d.id, d.status, d.source_type, d.drawn_at, d.resolved_at, d.corrected_at,
         d.round_number AS draw_round_number, d.preset_id, d.selection_series_ids,
         e.id AS episode_id, e.episode_key, e.series_id, s.name AS series_name,
         s.series_key, s.accent_color, s.archived AS series_archived, e.title,
         e.number_label, e.sort_order, e.release_date, e.duration_minutes,
         e.priority_on_release, e.archived, pref.favorite, pref.note,
         COALESCE(usr.round_number, 1) AS current_round_number,
         current_completion.id AS completion_id,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', el.id, 'label', el.label, 'url', el.url, 'sortOrder', el.sort_order
           ) ORDER BY el.sort_order, lower(el.label))
           FROM episode_links el WHERE el.episode_id=e.id
         ), '[]'::json) AS links,
         EXISTS(
           SELECT 1 FROM episode_completions restorable
           WHERE restorable.draw_id=d.id AND restorable.reversed_at IS NULL
             AND restorable.round_number=COALESCE(usr.round_number, 1)
         ) AS can_restore,
         EXISTS(SELECT 1 FROM episode_priority_offers priority_offer WHERE priority_offer.draw_id=d.id)
           AS was_priority
  FROM draws d
  JOIN episodes e ON e.id=d.episode_id
  JOIN series s ON s.id=e.series_id
  LEFT JOIN user_episode_preferences pref ON pref.user_id=d.user_id AND pref.episode_id=e.id
  LEFT JOIN user_series_rounds usr ON usr.user_id=d.user_id AND usr.series_id=e.series_id
  LEFT JOIN episode_completions current_completion
    ON current_completion.user_id=d.user_id
   AND current_completion.episode_id=e.id
   AND current_completion.round_number=COALESCE(usr.round_number, 1)
   AND current_completion.reversed_at IS NULL
`;

function mapDraw(row: DrawRow): ActiveDraw {
  return {
    id: row.id,
    status: row.status,
    sourceType: row.source_type,
    drawnAt: isoDateTime(row.drawn_at)!,
    resolvedAt: isoDateTime(row.resolved_at),
    correctedAt: isoDateTime(row.corrected_at),
    roundNumber: Number(row.draw_round_number),
    presetId: row.preset_id,
    selectionSeriesIds: row.selection_series_ids,
    wasPriority: Boolean(row.was_priority),
    episode: mapEpisode({
      id: row.episode_id,
      episode_key: row.episode_key,
      series_id: row.series_id,
      series_name: row.series_name,
      series_key: row.series_key,
      accent_color: row.accent_color,
      title: row.title,
      number_label: row.number_label,
      sort_order: row.sort_order,
      release_date: row.release_date,
      duration_minutes: row.duration_minutes,
      priority_on_release: row.priority_on_release,
      archived: row.archived,
      series_archived: row.series_archived,
      favorite: row.favorite,
      note: row.note,
      round_number: row.current_round_number,
      completion_id: row.completion_id,
      links: row.links as never,
    }),
  };
}

async function loadDraw(executor: Executor, userId: string, drawId: string): Promise<ActiveDraw | null> {
  const result = await executor.query<DrawRow>(`${drawSelect} WHERE d.user_id=$1 AND d.id=$2`, [userId, drawId]);
  return result.rowCount ? mapDraw(result.rows[0]) : null;
}

export async function getCurrentDraw(userId: string): Promise<ActiveDraw | null> {
  const result = await db().query<DrawRow>(
    `${drawSelect} WHERE d.user_id=$1 AND d.status='active' ORDER BY d.drawn_at DESC LIMIT 1`,
    [userId],
  );
  return result.rowCount ? mapDraw(result.rows[0]) : null;
}

export class EmptyPoolError extends AppError {
  constructor(seriesIds: string[]) {
    super(
      "In dieser Auswahl sind aktuell keine ungehörten Folgen mehr verfügbar.",
      409,
      "EMPTY_POOL",
      { seriesIds },
    );
  }
}

async function resolveSelection(
  client: PoolClient,
  userId: string,
  input: { seriesIds?: string[]; presetId?: string },
): Promise<{ seriesIds: string[]; presetId: string | null }> {
  if (input.presetId) {
    const preset = await client.query<{ id: string; series_id: string }>(
      `SELECT p.id, ps.series_id
       FROM presets p JOIN preset_series ps ON ps.preset_id=p.id
       JOIN series s ON s.id=ps.series_id
       WHERE p.id=$1 AND p.user_id=$2 AND s.archived=false`,
      [input.presetId, userId],
    );
    if (!preset.rowCount) throw new AppError("Preset nicht gefunden oder leer.", 404, "NOT_FOUND");
    return { seriesIds: preset.rows.map((row) => row.series_id), presetId: input.presetId };
  }

  const requested = [...new Set(input.seriesIds || [])];
  if (!requested.length) throw new AppError("Wähle mindestens eine Serie aus.");
  const found = await client.query<{ id: string }>(
    "SELECT id FROM series WHERE id = ANY($1::uuid[]) AND archived=false",
    [requested],
  );
  if (found.rowCount !== requested.length) {
    throw new AppError("Mindestens eine ausgewählte Serie existiert nicht oder ist archiviert.");
  }
  return { seriesIds: requested, presetId: null };
}

export async function drawEpisode(
  userId: string,
  input: { seriesIds?: string[]; presetId?: string },
): Promise<ActiveDraw> {
  const drawId = await transaction(async (client) => {
    await lockUser(client, userId);
    const active = await client.query<{ id: string }>(
      "SELECT id FROM draws WHERE user_id=$1 AND status='active' LIMIT 1",
      [userId],
    );
    if (active.rowCount) return active.rows[0].id;

    const selection = await resolveSelection(client, userId, input);
    const candidate = await client.query<{ episode_id: string; round_number: number; is_priority: boolean }>(
      `WITH eligible AS (
         SELECT e.id AS episode_id, COALESCE(usr.round_number, 1) AS round_number,
                (
                  e.priority_on_release = true
                  AND e.release_date IS NOT NULL
                  AND e.release_date >= u.catalog_baseline_date
                  AND po.episode_id IS NULL
                ) AS is_priority
         FROM episodes e
         JOIN series s ON s.id=e.series_id
         JOIN users u ON u.id=$1
         LEFT JOIN user_series_rounds usr ON usr.user_id=$1 AND usr.series_id=e.series_id
         LEFT JOIN episode_completions ec
           ON ec.user_id=$1 AND ec.episode_id=e.id
          AND ec.round_number=COALESCE(usr.round_number, 1) AND ec.reversed_at IS NULL
         LEFT JOIN episode_priority_offers po ON po.user_id=$1 AND po.episode_id=e.id
         WHERE e.series_id = ANY($2::uuid[])
           AND s.archived=false AND e.archived=false
           AND (e.release_date IS NULL OR e.release_date <= $3::date)
           AND ec.id IS NULL
       ), last_resolved AS (
         SELECT episode_id, status FROM draws
         WHERE user_id=$1 AND status <> 'active'
         ORDER BY resolved_at DESC NULLS LAST LIMIT 1
       ), last_skipped AS (
         SELECT episode_id FROM last_resolved WHERE status='skipped'
       )
       SELECT episode_id, round_number, is_priority
       FROM eligible
       WHERE episode_id <> COALESCE((SELECT episode_id FROM last_skipped), gen_random_uuid())
          OR (SELECT count(*) FROM eligible) = 1
       ORDER BY is_priority DESC, random()
       LIMIT 1`,
      [userId, selection.seriesIds, localDate()],
    );
    if (!candidate.rowCount) throw new EmptyPoolError(selection.seriesIds);

    const chosen = candidate.rows[0];
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO draws (
         user_id, episode_id, round_number, status, preset_id, selection_series_ids
       ) VALUES ($1,$2,$3,'active',$4,$5::uuid[]) RETURNING id`,
      [userId, chosen.episode_id, chosen.round_number, selection.presetId, selection.seriesIds],
    );
    if (chosen.is_priority) {
      await client.query(
        `INSERT INTO episode_priority_offers (user_id, episode_id, draw_id)
         VALUES ($1,$2,$3) ON CONFLICT (user_id, episode_id) DO NOTHING`,
        [userId, chosen.episode_id, inserted.rows[0].id],
      );
    }
    return inserted.rows[0].id;
  });

  const draw = await loadDraw(db(), userId, drawId);
  if (!draw) throw new AppError("Die Ziehung konnte nicht geladen werden.", 500, "DRAW_MISSING");
  return draw;
}

export async function resolveDraw(
  userId: string,
  drawId: string,
  outcome: "heard" | "skipped",
): Promise<ActiveDraw> {
  await transaction(async (client) => {
    await lockUser(client, userId);
    const result = await client.query<{
      id: string;
      status: "active" | "heard" | "skipped";
      episode_id: string;
      round_number: number;
      duration_minutes: number | null;
    }>(
      `SELECT d.id, d.status, d.episode_id, d.round_number, e.duration_minutes
       FROM draws d JOIN episodes e ON e.id=d.episode_id
       WHERE d.id=$1 AND d.user_id=$2 FOR UPDATE OF d`,
      [drawId, userId],
    );
    if (!result.rowCount) throw new AppError("Ziehung nicht gefunden.", 404, "NOT_FOUND");
    const draw = result.rows[0];
    if (draw.status === outcome) return;
    if (draw.status !== "active") {
      throw new AppError("Diese Ziehung wurde bereits anders abgeschlossen.", 409, "ALREADY_RESOLVED");
    }
    await client.query("UPDATE draws SET status=$1, resolved_at=now() WHERE id=$2", [outcome, drawId]);
    if (outcome === "heard") {
      await client.query(
        `INSERT INTO episode_completions (
           user_id, episode_id, round_number, draw_id, source_type, duration_minutes_snapshot
         ) VALUES ($1,$2,$3,$4,'random',$5)`,
        [userId, draw.episode_id, draw.round_number, drawId, draw.duration_minutes],
      );
    }
  });

  const draw = await loadDraw(db(), userId, drawId);
  if (!draw) throw new AppError("Die Ziehung konnte nicht geladen werden.", 500, "DRAW_MISSING");
  return draw;
}

export async function resetRounds(userId: string, seriesIds: string[]): Promise<void> {
  const ids = [...new Set(seriesIds)];
  if (!ids.length) throw new AppError("Wähle mindestens eine Serie zum Zurücksetzen aus.");
  await transaction(async (client) => {
    await lockUser(client, userId);
    const found = await client.query("SELECT id FROM series WHERE id=ANY($1::uuid[])", [ids]);
    if (found.rowCount !== ids.length) throw new AppError("Mindestens eine Serie wurde nicht gefunden.");
    const active = await client.query(
      `SELECT 1 FROM draws d JOIN episodes e ON e.id=d.episode_id
       WHERE d.user_id=$1 AND d.status='active' AND e.series_id=ANY($2::uuid[])`,
      [userId, ids],
    );
    if (active.rowCount) {
      throw new AppError("Die aktive Folge muss zuerst abgeschlossen oder übersprungen werden.", 409, "ACTIVE_EPISODE");
    }
    for (const seriesId of ids) {
      await client.query(
        `INSERT INTO user_series_rounds (user_id, series_id, round_number)
         VALUES ($1,$2,2)
         ON CONFLICT (user_id, series_id) DO UPDATE SET
           round_number=user_series_rounds.round_number+1, updated_at=now()`,
        [userId, seriesId],
      );
    }
  });
}

export async function getHistory(userId: string, limit = 100, offset = 0): Promise<HistoryItem[]> {
  const result = await db().query<DrawRow>(
    `${drawSelect} WHERE d.user_id=$1 AND d.status <> 'active'
     ORDER BY d.resolved_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return result.rows.map((row) => ({ ...mapDraw(row), canRestore: Boolean(row.can_restore) }));
}

export async function restoreHeardDraw(userId: string, drawId: string): Promise<void> {
  await transaction(async (client) => {
    await lockUser(client, userId);
    const restored = await client.query(
      `UPDATE episode_completions c SET reversed_at=now()
       FROM draws d, episodes e
       LEFT JOIN user_series_rounds usr ON usr.user_id=$1 AND usr.series_id=e.series_id
       WHERE c.draw_id=$2 AND c.user_id=$1 AND c.reversed_at IS NULL
         AND d.id=c.draw_id AND e.id=c.episode_id
         AND c.round_number=COALESCE(usr.round_number, 1)
       RETURNING c.draw_id`,
      [userId, drawId],
    );
    if (!restored.rowCount) {
      const existing = await client.query("SELECT 1 FROM draws WHERE id=$1 AND user_id=$2", [drawId, userId]);
      if (!existing.rowCount) throw new AppError("Eintrag nicht gefunden.", 404, "NOT_FOUND");
      return;
    }
    await client.query("UPDATE draws SET corrected_at=now() WHERE id=$1", [drawId]);
  });
}
