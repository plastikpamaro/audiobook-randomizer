import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { AppError } from "@/lib/app-error";
import { db, query, transaction } from "@/lib/db";
import { isoDateTime, localDate } from "@/lib/dates";
import { normalizeTitle, stableEpisodeKey } from "@/lib/feed-parsers";
import { fetchImportFeed } from "@/lib/online-import-fetch";
import type {
  ImportPreviewResult,
  ImportProposalSummary,
  ImportRunSummary,
  ImportSourceKind,
  ImportSourceSummary,
  NormalizedImportEpisode,
} from "@/lib/online-import-types";
import { assertPublicHttpsUrl } from "@/lib/safe-fetch";

interface SourceRow extends QueryResultRow {
  id: string;
  created_by_user_id: string;
  series_id: string;
  series_name: string;
  kind: ImportSourceKind;
  name: string;
  url: string | null;
  enabled: boolean;
  first_import_completed_at: string | Date | null;
  etag: string | null;
  last_modified: string | null;
  last_checked_at: string | Date | null;
  last_success_at: string | Date | null;
  last_error: string | null;
  last_item_count: number | null;
  pending_proposal_count: number | string;
}

interface RunRow extends QueryResultRow {
  id: string;
  source_id: string;
  trigger_type: "preview" | "manual" | "scheduled";
  status: ImportRunSummary["status"];
  fetched_item_count: number;
  new_item_count: number;
  changed_item_count: number;
  invalid_item_count: number;
  warning_count: number;
  error_message: string | null;
  details: Record<string, unknown> | string;
  started_at: string | Date;
  finished_at: string | Date | null;
}

interface ProposalRow extends QueryResultRow {
  id: string;
  source_id: string;
  run_id: string;
  external_id: string;
  proposal_type: "create" | "link" | "update";
  candidate_episode_id: string | null;
  candidate_title: string | null;
  source_payload: NormalizedImportEpisode | string;
  field_changes: Record<string, { from: unknown; to: unknown }> | string;
  status: "pending" | "accepted" | "rejected";
}

interface CatalogEpisodeRow extends QueryResultRow {
  id: string;
  episode_key: string;
  title: string;
  number_label: string | null;
  sort_order: number | null;
  release_date: string | Date | null;
  duration_minutes: number | null;
  priority_on_release: boolean;
}

const sourceSelect = `
  SELECT src.*, s.name AS series_name,
         (SELECT count(*) FROM import_proposals p WHERE p.source_id=src.id AND p.status='pending') AS pending_proposal_count
  FROM import_sources src JOIN series s ON s.id=src.series_id
`;

function mapSource(row: SourceRow): ImportSourceSummary {
  return {
    id: row.id,
    seriesId: row.series_id,
    seriesName: row.series_name,
    kind: row.kind,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    confirmed: Boolean(row.first_import_completed_at),
    lastCheckedAt: isoDateTime(row.last_checked_at),
    lastSuccessAt: isoDateTime(row.last_success_at),
    lastError: row.last_error,
    lastItemCount: row.last_item_count == null ? null : Number(row.last_item_count),
    pendingProposalCount: Number(row.pending_proposal_count),
  };
}

function mapRun(row: RunRow): ImportRunSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    triggerType: row.trigger_type,
    status: row.status,
    fetchedItemCount: Number(row.fetched_item_count),
    newItemCount: Number(row.new_item_count),
    changedItemCount: Number(row.changed_item_count),
    invalidItemCount: Number(row.invalid_item_count),
    warningCount: Number(row.warning_count),
    errorMessage: row.error_message,
    startedAt: isoDateTime(row.started_at)!,
    finishedAt: isoDateTime(row.finished_at),
  };
}

function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function mapProposal(row: ProposalRow): ImportProposalSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    runId: row.run_id,
    externalId: row.external_id,
    proposalType: row.proposal_type,
    candidateEpisodeId: row.candidate_episode_id,
    candidateTitle: row.candidate_title,
    episode: jsonValue(row.source_payload),
    fieldChanges: jsonValue(row.field_changes),
    status: row.status,
  };
}

function hashPayload(episode: NormalizedImportEpisode): string {
  return createHash("sha256").update(JSON.stringify(episode)).digest("hex");
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Unbekannter Importfehler";
}

function importedPriority(episode: NormalizedImportEpisode, firstImportedAt: string | Date | null): boolean {
  if (!episode.releaseDate) return false;
  if (!firstImportedAt) return episode.releaseDate > localDate();
  return episode.releaseDate >= localDate(new Date(firstImportedAt));
}

function fieldChanges(episode: NormalizedImportEpisode, catalog: CatalogEpisodeRow): Record<string, { from: unknown; to: unknown }> {
  const result: Record<string, { from: unknown; to: unknown }> = {};
  const fields: Array<[string, unknown, unknown]> = [
    ["title", catalog.title, episode.title],
    ["numberLabel", catalog.number_label, episode.numberLabel],
    ["sortOrder", catalog.sort_order, episode.sortOrder],
    ["releaseDate", catalog.release_date ? localDate(new Date(catalog.release_date)) : null, episode.releaseDate],
    ["durationMinutes", catalog.duration_minutes, episode.durationMinutes],
  ];
  for (const [key, from, to] of fields) if (from !== to && to !== null) result[key] = { from, to };
  return result;
}

async function loadSource(executor: Pick<PoolClient, "query">, sourceId: string, forUpdate = false): Promise<SourceRow> {
  const result = await executor.query<SourceRow>(`${sourceSelect} WHERE src.id=$1 ${forUpdate ? "FOR UPDATE OF src" : ""}`, [sourceId]);
  if (!result.rowCount) throw new AppError("Importquelle nicht gefunden.", 404, "NOT_FOUND");
  return result.rows[0];
}

async function loadCatalogEpisodes(executor: Pick<PoolClient, "query">, seriesId: string): Promise<CatalogEpisodeRow[]> {
  const result = await executor.query<CatalogEpisodeRow>(
    `SELECT id, episode_key, title, number_label, sort_order, release_date, duration_minutes, priority_on_release
     FROM episodes WHERE series_id=$1`,
    [seriesId],
  );
  return result.rows;
}

function suggestedEpisode(episode: NormalizedImportEpisode, catalog: CatalogEpisodeRow[]): CatalogEpisodeRow | null {
  const title = normalizeTitle(episode.title);
  const exactTitle = catalog.filter((item) => normalizeTitle(item.title) === title);
  if (episode.numberLabel) {
    const numberAndTitle = exactTitle.filter((item) => item.number_label?.toLocaleLowerCase("de") === episode.numberLabel?.toLocaleLowerCase("de"));
    if (numberAndTitle.length === 1) return numberAndTitle[0];
  }
  return exactTitle.length === 1 ? exactTitle[0] : null;
}

async function insertProposal(
  client: PoolClient,
  input: {
    sourceId: string;
    runId: string;
    episode: NormalizedImportEpisode;
    type: "create" | "link" | "update";
    candidateId?: string | null;
    changes?: Record<string, { from: unknown; to: unknown }>;
  },
): Promise<string | null> {
  const payloadHash = hashPayload(input.episode);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO import_proposals (
       source_id, run_id, external_id, proposal_type, candidate_episode_id,
       payload_hash, source_payload, field_changes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT (source_id, external_id, proposal_type, payload_hash) DO NOTHING
     RETURNING id`,
    [
      input.sourceId, input.runId, input.episode.externalId, input.type, input.candidateId || null,
      payloadHash, JSON.stringify(input.episode), JSON.stringify(input.changes || {}),
    ],
  );
  return inserted.rows[0]?.id || null;
}

async function replaceImportedLinks(client: PoolClient, sourceId: string, episodeId: string, episode: NormalizedImportEpisode): Promise<void> {
  await client.query("DELETE FROM episode_links WHERE episode_id=$1 AND import_source_id=$2", [episodeId, sourceId]);
  for (const [sortOrder, link] of episode.links.entries()) {
    await client.query(
      `INSERT INTO episode_links (episode_id, label, url, sort_order, import_source_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (episode_id, label, url) DO UPDATE SET sort_order=EXCLUDED.sort_order, import_source_id=EXCLUDED.import_source_id`,
      [episodeId, link.label, link.url, sortOrder, sourceId],
    );
  }
}

async function createImportedEpisode(
  client: PoolClient,
  source: SourceRow,
  episode: NormalizedImportEpisode,
  firstImport: boolean,
): Promise<string> {
  const episodeKey = stableEpisodeKey(episode.externalId, episode.title);
  const created = await client.query<{ id: string }>(
    `INSERT INTO episodes (
       series_id, episode_key, number_label, sort_order, title, release_date,
       duration_minutes, priority_on_release
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      source.series_id, episodeKey, episode.numberLabel, episode.sortOrder, episode.title,
      episode.releaseDate, episode.durationMinutes,
      firstImport ? importedPriority(episode, null) : importedPriority(episode, source.first_import_completed_at),
    ],
  );
  const episodeId = created.rows[0].id;
  await replaceImportedLinks(client, source.id, episodeId, episode);
  return episodeId;
}

async function mapSourceItem(client: PoolClient, sourceId: string, episodeId: string, episode: NormalizedImportEpisode): Promise<void> {
  await client.query(
    `INSERT INTO import_source_items (source_id, external_id, episode_id, payload_hash, source_payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (source_id, external_id) DO UPDATE SET
       episode_id=EXCLUDED.episode_id, payload_hash=EXCLUDED.payload_hash,
       source_payload=EXCLUDED.source_payload, last_seen_at=now()`,
    [sourceId, episode.externalId, episodeId, hashPayload(episode), JSON.stringify(episode)],
  );
}

async function applyProposalRow(
  client: PoolClient,
  source: SourceRow,
  proposal: ProposalRow,
  userId: string,
  overrideEpisodeId?: string,
  firstImport = false,
): Promise<void> {
  if (proposal.status === "accepted") return;
  if (proposal.status !== "pending") throw new AppError("Dieser Vorschlag wurde bereits abgelehnt.", 409, "PROPOSAL_RESOLVED");
  const episode = jsonValue(proposal.source_payload);
  let episodeId = overrideEpisodeId || proposal.candidate_episode_id;
  if (proposal.proposal_type === "create") {
    episodeId = await createImportedEpisode(client, source, episode, firstImport);
  } else if (proposal.proposal_type === "link") {
    if (!episodeId) throw new AppError("Für die Verknüpfung muss eine Folge gewählt werden.", 422, "EPISODE_REQUIRED");
    const candidate = await client.query("SELECT 1 FROM episodes WHERE id=$1 AND series_id=$2", [episodeId, source.series_id]);
    if (!candidate.rowCount) throw new AppError("Die gewählte Folge gehört nicht zur Quellserie.", 422, "INVALID_EPISODE");
    await replaceImportedLinks(client, source.id, episodeId, episode);
  } else {
    const mapped = await client.query<{ episode_id: string }>(
      "SELECT episode_id FROM import_source_items WHERE source_id=$1 AND external_id=$2 FOR UPDATE",
      [source.id, episode.externalId],
    );
    if (!mapped.rowCount) throw new AppError("Die externe Folge ist nicht mehr verknüpft.", 409, "MAPPING_MISSING");
    episodeId = mapped.rows[0].episode_id;
    await client.query(
      `UPDATE episodes SET title=$2, number_label=$3, sort_order=$4,
         release_date=$5, duration_minutes=$6,
         priority_on_release=priority_on_release OR $7, updated_at=now()
       WHERE id=$1`,
      [episodeId, episode.title, episode.numberLabel, episode.sortOrder, episode.releaseDate, episode.durationMinutes, importedPriority(episode, source.first_import_completed_at)],
    );
    await replaceImportedLinks(client, source.id, episodeId, episode);
  }
  if (!episodeId) throw new AppError("Der Vorschlag konnte keiner Folge zugeordnet werden.", 500, "MAPPING_FAILED");
  await mapSourceItem(client, source.id, episodeId, episode);
  await client.query(
    `UPDATE import_proposals SET status='accepted', resolved_at=now(), resolved_by_user_id=$2 WHERE id=$1`,
    [proposal.id, userId],
  );
}

async function proposalById(client: PoolClient, proposalId: string): Promise<ProposalRow> {
  const result = await client.query<ProposalRow>(
    `SELECT p.*, e.title AS candidate_title
     FROM import_proposals p LEFT JOIN episodes e ON e.id=p.candidate_episode_id
     WHERE p.id=$1 FOR UPDATE OF p`,
    [proposalId],
  );
  if (!result.rowCount) throw new AppError("Änderungsvorschlag nicht gefunden.", 404, "NOT_FOUND");
  return result.rows[0];
}

export async function getImportSources(): Promise<ImportSourceSummary[]> {
  const rows = await query<SourceRow>(`${sourceSelect} ORDER BY lower(src.name)`);
  return rows.map(mapSource);
}

export async function createImportSource(
  userId: string,
  input: { seriesId: string; kind: ImportSourceKind; name: string; url?: string | null },
): Promise<string> {
  const builtIn = input.kind === "drei_fragezeichen" || input.kind === "tkkg";
  const url = builtIn ? null : input.url?.trim() || null;
  if (!builtIn && !url) throw new AppError("Für diese Quelle wird eine HTTPS-URL benötigt.");
  if (url) await assertPublicHttpsUrl(url);
  const result = await db().query<{ id: string }>(
    `INSERT INTO import_sources (created_by_user_id, series_id, kind, name, url)
     SELECT $1, s.id, $3, $4, $5 FROM series s WHERE s.id=$2
     RETURNING id`,
    [userId, input.seriesId, input.kind, input.name.trim(), url],
  );
  if (!result.rowCount) throw new AppError("Serie nicht gefunden.", 404, "NOT_FOUND");
  return result.rows[0].id;
}

export async function updateImportSource(
  sourceId: string,
  input: { name?: string; enabled?: boolean; url?: string | null },
): Promise<void> {
  const source = await loadSource(db(), sourceId);
  if (Object.hasOwn(input, "url") && source.first_import_completed_at) {
    throw new AppError("Die URL einer bestätigten Quelle kann nicht geändert werden. Lege dafür eine neue Quelle an.", 409, "SOURCE_ALREADY_CONFIRMED");
  }
  let url: string | null | undefined;
  if (Object.hasOwn(input, "url")) {
    url = input.url?.trim() || null;
    if (source.kind === "csv" || source.kind === "json" || source.kind === "rss") {
      if (!url) throw new AppError("Für diese Quelle wird eine HTTPS-URL benötigt.");
      await assertPublicHttpsUrl(url);
    }
  }
  const result = await db().query(
    `UPDATE import_sources SET
       name=COALESCE($2,name), enabled=COALESCE($3,enabled),
       url=CASE WHEN $4::boolean THEN $5 ELSE url END,
       etag=CASE WHEN $4::boolean THEN NULL ELSE etag END,
       last_modified=CASE WHEN $4::boolean THEN NULL ELSE last_modified END,
       updated_at=now()
     WHERE id=$1`,
    [sourceId, input.name?.trim() || null, input.enabled ?? null, Object.hasOwn(input, "url"), url ?? null],
  );
  if (!result.rowCount) throw new AppError("Importquelle nicht gefunden.", 404, "NOT_FOUND");
}

export async function disableImportSource(sourceId: string): Promise<void> {
  const result = await db().query("UPDATE import_sources SET enabled=false, updated_at=now() WHERE id=$1", [sourceId]);
  if (!result.rowCount) throw new AppError("Importquelle nicht gefunden.", 404, "NOT_FOUND");
}

export async function getImportRuns(sourceId: string, limit = 30): Promise<ImportRunSummary[]> {
  const rows = await query<RunRow>(
    "SELECT * FROM import_runs WHERE source_id=$1 ORDER BY started_at DESC LIMIT $2",
    [sourceId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map(mapRun);
}

export async function getImportProposals(sourceId?: string, runId?: string): Promise<ImportProposalSummary[]> {
  const rows = await query<ProposalRow>(
    `SELECT p.*, e.title AS candidate_title
     FROM import_proposals p LEFT JOIN episodes e ON e.id=p.candidate_episode_id
     WHERE ($1::uuid IS NULL OR p.source_id=$1) AND ($2::uuid IS NULL OR p.run_id=$2)
     ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC`,
    [sourceId || null, runId || null],
  );
  return rows.map(mapProposal);
}

async function createRun(
  client: PoolClient,
  sourceId: string,
  triggerType: "preview" | "manual" | "scheduled",
  scheduledDate?: string,
): Promise<RunRow | null> {
  const result = await client.query<RunRow>(
    `INSERT INTO import_runs (source_id, trigger_type, status, scheduled_local_date)
     VALUES ($1,$2,'running',$3)
     ON CONFLICT (source_id, scheduled_local_date)
       WHERE trigger_type='scheduled' AND scheduled_local_date IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [sourceId, triggerType, scheduledDate || null],
  );
  return result.rows[0] || null;
}

async function finishRun(
  client: PoolClient,
  runId: string,
  input: Partial<{
    status: ImportRunSummary["status"];
    fetched: number;
    added: number;
    changed: number;
    invalid: number;
    warnings: number;
    error: string | null;
    details: Record<string, unknown>;
  }>,
): Promise<RunRow> {
  const result = await client.query<RunRow>(
    `UPDATE import_runs SET status=COALESCE($2,status), fetched_item_count=COALESCE($3,fetched_item_count),
       new_item_count=COALESCE($4,new_item_count), changed_item_count=COALESCE($5,changed_item_count),
       invalid_item_count=COALESCE($6,invalid_item_count), warning_count=COALESCE($7,warning_count),
       error_message=$8, details=COALESCE($9::jsonb,details), finished_at=now()
     WHERE id=$1 RETURNING *`,
    [runId, input.status || null, input.fetched ?? null, input.added ?? null, input.changed ?? null, input.invalid ?? null, input.warnings ?? null, input.error ?? null, input.details ? JSON.stringify(input.details) : null],
  );
  return result.rows[0];
}

async function withSourceLock<T>(sourceId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
      [`import-source:${sourceId}`],
    );
    locked = lock.rows[0].locked;
    if (!locked) throw new AppError("Diese Quelle wird bereits geprüft.", 409, "IMPORT_ALREADY_RUNNING");
    return await work(client);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`import-source:${sourceId}`]).catch(() => undefined);
    client.release();
  }
}

export async function previewImportSource(sourceId: string): Promise<ImportPreviewResult> {
  return withSourceLock(sourceId, async (client) => {
    const source = await loadSource(client, sourceId);
    if (source.first_import_completed_at) throw new AppError("Diese Quelle wurde bereits bestätigt. Nutze „Jetzt prüfen“.", 409, "SOURCE_ALREADY_CONFIRMED");
    const run = await createRun(client, sourceId, "preview");
    if (!run) throw new AppError("Vorschau konnte nicht gestartet werden.", 500, "RUN_FAILED");
    try {
      const fetched = await fetchImportFeed(source, false);
      const feed = fetched.feed;
      if (!feed) throw new AppError("Die Quelle lieferte keine Daten.", 422, "IMPORT_EMPTY");
      if (!feed.episodes.length) {
        const finished = await finishRun(client, run.id, { status: "needs_review", invalid: feed.issues.length, warnings: feed.warnings.length, error: "Die Quelle enthält keine gültigen Folgen.", details: { issues: feed.issues, warnings: feed.warnings } });
        return { run: mapRun(finished), proposals: [], warnings: feed.warnings };
      }
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM import_proposals WHERE source_id=$1 AND status='pending'", [sourceId]);
        const catalog = await loadCatalogEpisodes(client, source.series_id);
        for (const episode of feed.episodes) {
          const candidate = suggestedEpisode(episode, catalog);
          await insertProposal(client, {
            sourceId, runId: run.id, episode,
            type: candidate ? "link" : "create",
            candidateId: candidate?.id,
          });
        }
        const status = feed.issues.length ? "needs_review" : "awaiting_confirmation";
        const finished = await finishRun(client, run.id, {
          status,
          fetched: feed.episodes.length,
          added: feed.episodes.length,
          invalid: feed.issues.length,
          warnings: feed.warnings.length,
          error: feed.issues.length ? "Die Quelle enthält ungültige oder doppelte Einträge." : null,
          details: { issues: feed.issues, warnings: feed.warnings },
        });
        await client.query(
          "UPDATE import_sources SET last_checked_at=now(), last_error=$2, etag=$3, last_modified=$4, updated_at=now() WHERE id=$1",
          [sourceId, feed.issues.length ? "Vorschau enthält Fehler." : null, fetched.etag, fetched.lastModified],
        );
        await client.query("COMMIT");
        return { run: mapRun(finished), proposals: await proposalsForRun(client, run.id), warnings: feed.warnings };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if ((await client.query("SELECT status FROM import_runs WHERE id=$1", [run.id])).rows[0]?.status === "running") {
        await finishRun(client, run.id, { status: "failed", error: displayError(error) });
        await client.query("UPDATE import_sources SET last_checked_at=now(), last_error=$2, updated_at=now() WHERE id=$1", [sourceId, displayError(error)]);
      }
      throw error;
    }
  });
}

async function proposalsForRun(client: PoolClient, runId: string): Promise<ImportProposalSummary[]> {
  const result = await client.query<ProposalRow>(
    `SELECT p.*, e.title AS candidate_title FROM import_proposals p
     LEFT JOIN episodes e ON e.id=p.candidate_episode_id WHERE p.run_id=$1 ORDER BY p.created_at`,
    [runId],
  );
  return result.rows.map(mapProposal);
}

export async function commitImportPreview(
  userId: string,
  runId: string,
  resolutions: Array<{ proposalId: string; action: "create" | "link" | "ignore"; episodeId?: string }>,
): Promise<void> {
  await transaction(async (client) => {
    const runResult = await client.query<RunRow>("SELECT * FROM import_runs WHERE id=$1 FOR UPDATE", [runId]);
    if (!runResult.rowCount) throw new AppError("Importvorschau nicht gefunden.", 404, "NOT_FOUND");
    const run = runResult.rows[0];
    if (run.status === "succeeded") return;
    if (run.status !== "awaiting_confirmation") throw new AppError("Diese Vorschau kann wegen Fehlern nicht übernommen werden.", 409, "PREVIEW_NOT_READY");
    const source = await loadSource(client, run.source_id, true);
    if (source.first_import_completed_at) throw new AppError("Die Quelle wurde bereits bestätigt.", 409, "SOURCE_ALREADY_CONFIRMED");
    const proposals = await client.query<ProposalRow>("SELECT * FROM import_proposals WHERE run_id=$1 ORDER BY created_at FOR UPDATE", [runId]);
    const choices = new Map(resolutions.map((item) => [item.proposalId, item]));
    if (choices.size !== proposals.rowCount) throw new AppError("Für jeden Eintrag wird eine Entscheidung benötigt.", 422, "RESOLUTION_REQUIRED");
    for (const proposal of proposals.rows) {
      const choice = choices.get(proposal.id);
      if (!choice) throw new AppError("Für jeden Eintrag wird eine Entscheidung benötigt.", 422, "RESOLUTION_REQUIRED");
      if (choice.action === "ignore") {
        await client.query("UPDATE import_proposals SET status='rejected', resolved_at=now(), resolved_by_user_id=$2 WHERE id=$1", [proposal.id, userId]);
        continue;
      }
      const effective = { ...proposal, proposal_type: choice.action } as ProposalRow;
      await applyProposalRow(client, source, effective, userId, choice.episodeId, true);
    }
    const acceptedCount = proposals.rows.filter((item) => choices.get(item.id)?.action !== "ignore").length;
    await client.query(
      `UPDATE import_sources SET enabled=true, first_import_completed_at=now(), last_success_at=now(),
         last_error=NULL, last_item_count=$2, updated_at=now() WHERE id=$1`,
      [source.id, run.fetched_item_count],
    );
    await client.query(
      `UPDATE import_runs SET status='succeeded', new_item_count=$2, error_message=NULL, finished_at=COALESCE(finished_at,now()) WHERE id=$1`,
      [runId, acceptedCount],
    );
  });
}

function unsafeQuantity(previous: number | null, current: number, newCount: number): string | null {
  if (current === 0) return "Die Quelle liefert keine Folgen.";
  if (newCount > 20) return `Die Quelle enthält ${newCount} neue Einträge; mehr als 20 werden nicht automatisch übernommen.`;
  if (previous && (current < Math.floor(previous * 0.5) || current > previous * 2 + 20)) {
    return `Die Eintragszahl weicht stark vom letzten Lauf ab (${previous} → ${current}).`;
  }
  return null;
}

export async function syncImportSource(
  sourceId: string,
  triggerType: "manual" | "scheduled" = "manual",
  scheduledDate?: string,
  fetcher: typeof fetchImportFeed = fetchImportFeed,
): Promise<ImportRunSummary | null> {
  return withSourceLock(sourceId, async (client) => {
    const source = await loadSource(client, sourceId);
    if (!source.first_import_completed_at) throw new AppError("Bestätige zuerst den Erstimport.", 409, "SOURCE_NOT_CONFIRMED");
    if (triggerType === "scheduled" && !source.enabled) return null;
    const run = await createRun(client, sourceId, triggerType, scheduledDate);
    if (!run) return null;
    try {
      const fetched = await fetcher(source, true);
      if (fetched.notModified) {
        const finished = await finishRun(client, run.id, { status: "not_modified" });
        await client.query(
          "UPDATE import_sources SET last_checked_at=now(), last_success_at=now(), last_error=NULL, updated_at=now() WHERE id=$1",
          [sourceId],
        );
        return mapRun(finished);
      }
      const feed = fetched.feed;
      if (!feed) throw new AppError("Die Quelle lieferte keine Daten.", 422, "IMPORT_EMPTY");
      await client.query("BEGIN");
      try {
        const mappings = await client.query<{ external_id: string; episode_id: string; payload_hash: string }>(
          "SELECT external_id, episode_id, payload_hash FROM import_source_items WHERE source_id=$1",
          [sourceId],
        );
        const rejected = await client.query<{ external_id: string; payload_hash: string }>(
          "SELECT external_id,payload_hash FROM import_proposals WHERE source_id=$1 AND status='rejected'",
          [sourceId],
        );
        const rejectedHashes = new Set(rejected.rows.map((item) => `${item.external_id}\0${item.payload_hash}`));
        const mappingByExternal = new Map(mappings.rows.map((item) => [item.external_id, item]));
        const catalog = await loadCatalogEpisodes(client, source.series_id);
        const newEpisodes = feed.episodes.filter((episode) => !mappingByExternal.has(episode.externalId));
        const quantityError = feed.issues.length ? "Die Quelle enthält ungültige oder doppelte Einträge." : unsafeQuantity(source.last_item_count, feed.episodes.length, newEpisodes.length);
        let added = 0;
        let changed = 0;
        for (const episode of feed.episodes) {
          const mapped = mappingByExternal.get(episode.externalId);
          const hash = hashPayload(episode);
          if (mapped) {
            await client.query("UPDATE import_source_items SET last_seen_at=now() WHERE source_id=$1 AND external_id=$2", [sourceId, episode.externalId]);
            if (mapped.payload_hash !== hash) {
              const target = catalog.find((item) => item.id === mapped.episode_id);
              await insertProposal(client, { sourceId, runId: run.id, episode, type: "update", candidateId: mapped.episode_id, changes: target ? fieldChanges(episode, target) : {} });
              changed += 1;
            }
            continue;
          }
          if (rejectedHashes.has(`${episode.externalId}\0${hash}`)) continue;
          const candidate = suggestedEpisode(episode, catalog);
          if (!quantityError && !candidate) {
            const episodeId = await createImportedEpisode(client, source, episode, false);
            await mapSourceItem(client, sourceId, episodeId, episode);
            catalog.push({ id: episodeId, episode_key: stableEpisodeKey(episode.externalId, episode.title), title: episode.title, number_label: episode.numberLabel, sort_order: episode.sortOrder, release_date: episode.releaseDate, duration_minutes: episode.durationMinutes, priority_on_release: importedPriority(episode, source.first_import_completed_at) });
            added += 1;
          } else {
            await insertProposal(client, { sourceId, runId: run.id, episode, type: candidate ? "link" : "create", candidateId: candidate?.id });
            added += 1;
          }
        }
        const status = quantityError ? "needs_review" : "succeeded";
        const finished = await finishRun(client, run.id, {
          status,
          fetched: feed.episodes.length,
          added,
          changed,
          invalid: feed.issues.length,
          warnings: feed.warnings.length,
          error: quantityError,
          details: { issues: feed.issues, warnings: feed.warnings },
        });
        await client.query(
          `UPDATE import_sources SET last_checked_at=now(),
             last_success_at=CASE WHEN $2::boolean THEN last_success_at ELSE now() END,
             last_error=$3, last_item_count=CASE WHEN $2::boolean THEN last_item_count ELSE $4 END,
             etag=$5, last_modified=$6, updated_at=now()
           WHERE id=$1`,
          [sourceId, Boolean(quantityError), quantityError, feed.episodes.length, fetched.etag, fetched.lastModified],
        );
        await client.query("COMMIT");
        return mapRun(finished);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      const current = await client.query<{ status: string }>("SELECT status FROM import_runs WHERE id=$1", [run.id]);
      if (current.rows[0]?.status === "running") {
        await finishRun(client, run.id, { status: "failed", error: displayError(error) });
        await client.query("UPDATE import_sources SET last_checked_at=now(), last_error=$2, updated_at=now() WHERE id=$1", [sourceId, displayError(error)]);
      }
      throw error;
    }
  });
}

export async function acceptImportProposal(userId: string, proposalId: string, episodeId?: string): Promise<void> {
  await transaction(async (client) => {
    const proposal = await proposalById(client, proposalId);
    if (proposal.status === "accepted") return;
    const source = await loadSource(client, proposal.source_id, true);
    if (!source.first_import_completed_at) {
      throw new AppError("Vorschläge des Erstimports müssen gemeinsam bestätigt werden.", 409, "INITIAL_COMMIT_REQUIRED");
    }
    await applyProposalRow(client, source, proposal, userId, episodeId, false);
  });
}

export async function rejectImportProposal(userId: string, proposalId: string): Promise<void> {
  await transaction(async (client) => {
    const proposal = await proposalById(client, proposalId);
    if (proposal.status === "rejected") return;
    if (proposal.status === "accepted") throw new AppError("Der Vorschlag wurde bereits angenommen.", 409, "PROPOSAL_RESOLVED");
    await client.query(
      "UPDATE import_proposals SET status='rejected', resolved_at=now(), resolved_by_user_id=$2 WHERE id=$1",
      [proposalId, userId],
    );
  });
}

export async function dueImportSourceIds(localDay: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT src.id FROM import_sources src
     WHERE src.enabled=true AND src.first_import_completed_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM import_runs r WHERE r.source_id=src.id
           AND r.trigger_type='scheduled' AND r.scheduled_local_date=$1::date
       )
     ORDER BY src.created_at`,
    [localDay],
  );
  return rows.map((row) => row.id);
}

export async function updateWorkerHeartbeat(error?: string | null): Promise<void> {
  await db().query(
    `INSERT INTO import_worker_state (worker_key, heartbeat_at, last_error)
     VALUES ('daily-import',now(),$1)
     ON CONFLICT (worker_key) DO UPDATE SET heartbeat_at=now(), last_error=$1, updated_at=now()`,
    [error || null],
  );
}
