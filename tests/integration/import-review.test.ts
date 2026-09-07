import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedImportEpisode } from "@/lib/online-import-types";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Importprüfung mit Datenbank", () => {
  let pool: Pool;
  let userId: string;
  let sourceId: string;
  const episode: NormalizedImportEpisode = {
    externalId: "87", title: "Der böse Geist vom Waisenhaus", numberLabel: "87", sortOrder: 87,
    releaseDate: "1993-01-01", durationMinutes: 45, priorityOnRelease: true,
    links: [{ label: "Hören", url: "https://example.org/87" }], canonicalUrl: "https://example.org/87",
  };
  const fetcher = (episodes = [episode]) => async () => ({ feed: { episodes, issues: [], warnings: [] }, notModified: false, etag: null, lastModified: null, finalUrl: "https://example.org/feed" });
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.includes("test")) throw new Error("Testdatenbank erforderlich");
    process.env.DATABASE_URL = url;
    process.env.TZ = "Europe/Berlin";
    pool = new Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of ["0001_initial", "0002_online_imports_and_ratings", "0003_catalog_deletion", "0004_deleted_import_items", "0005_detective_catalogs"]) await pool.query(await readFile(`migrations/${file}.sql`, "utf8"));
    userId = (await pool.query("INSERT INTO users(email,password_hash,role,catalog_baseline_date) VALUES ('review@example.org','x','owner',current_date) RETURNING id")).rows[0].id;
    const seriesId = (await pool.query("INSERT INTO series(series_key,name) VALUES ('review','Review') RETURNING id")).rows[0].id;
    sourceId = (await pool.query("INSERT INTO import_sources(created_by_user_id,series_id,kind,name) VALUES ($1,$2,'tkkg','TKKG') RETURNING id", [userId, seriesId])).rows[0].id;
  });
  afterAll(async () => { const { db } = await import("@/lib/db"); await db().end(); await pool.end(); });

  it("importiert, bestätigt und liest unverändert erneut ohne falschen Vorschlag", async () => {
    const service = await import("@/lib/online-import-service");
    const preview = await service.previewImportSource(sourceId, fetcher());
    await service.commitImportPreview(userId, preview.run.id, preview.proposals.map((p) => ({ proposalId: p.id, action: "create" as const })));
    const run = await service.syncImportSource(sourceId, "manual", undefined, fetcher());
    expect(run?.changedItemCount).toBe(0);
    expect((await service.getImportProposals(sourceId)).filter((p) => p.status === "pending")).toEqual([]);
  });

  it("entfernt alte Hash-Fehlmeldungen per Migration und behält echte Linkänderungen", async () => {
    const mapping = (await pool.query("SELECT * FROM import_source_items WHERE source_id=$1", [sourceId])).rows[0];
    const run = (await pool.query("SELECT id FROM import_runs WHERE source_id=$1 LIMIT 1", [sourceId])).rows[0];
    for (const [index, payload] of [episode, { ...episode, links: [{ label: "Neu", url: "https://example.org/new" }] }].entries()) {
      await pool.query("INSERT INTO import_proposals(source_id,run_id,external_id,proposal_type,candidate_episode_id,payload_hash,source_payload) VALUES ($1,$2,'87','update',$3,$4,$5::jsonb)", [sourceId, run.id, mapping.episode_id, String(index).repeat(64), JSON.stringify(payload)]);
    }
    await pool.query(await readFile("migrations/0006_import_change_review.sql", "utf8"));
    const pending = (await pool.query("SELECT field_changes FROM import_proposals WHERE status='pending'")).rows;
    expect(pending).toHaveLength(1);
    expect(pending[0].field_changes.links.from).toEqual(episode.links);
    expect(pending[0].field_changes.links.to[0].url).toBe("https://example.org/new");
    const service = await import("@/lib/online-import-service");
    await service.syncImportSource(sourceId, "manual", undefined, fetcher());
    expect((await service.getImportProposals(sourceId)).filter((p) => p.status === "pending")).toEqual([]);
  });

  it("zeigt echte Unterschiede, ersetzt überholte Vorschläge und merkt sich Ablehnungen", async () => {
    const service = await import("@/lib/online-import-service");
    await service.syncImportSource(sourceId, "manual", undefined, fetcher([{ ...episode, title: "Neue Schreibweise" }]));
    const changed = { ...episode, title: "Korrigierte Schreibweise", links: [{ label: "Neu", url: "https://example.org/new" }] };
    await service.syncImportSource(sourceId, "manual", undefined, fetcher([changed]));
    const pending = (await service.getImportProposals(sourceId)).filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].fieldChanges.title).toEqual({ from: episode.title, to: changed.title });
    expect(pending[0].fieldChanges.links).toEqual({ from: episode.links, to: changed.links });
    await service.resolveImportProposals(userId, [pending[0].id], "reject");
    expect((await service.syncImportSource(sourceId, "manual", undefined, fetcher([changed])))?.changedItemCount).toBe(0);
    expect((await service.getImportProposals(sourceId)).filter((p) => p.status === "pending")).toEqual([]);
  });

  it("übernimmt eine Auswahl atomar, erhält fehlende Angaben und priorisiert keine alte Folge neu", async () => {
    const service = await import("@/lib/online-import-service");
    const changed = { ...episode, title: "Finaler Titel", releaseDate: "2099-01-01", durationMinutes: null, numberLabel: null, sortOrder: null };
    await service.syncImportSource(sourceId, "manual", undefined, fetcher([changed]));
    const pending = (await service.getImportProposals(sourceId)).filter((p) => p.status === "pending");
    await expect(service.resolveImportProposals(userId, [pending[0].id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"], "accept")).rejects.toMatchObject({ code: "PROPOSAL_RESOLVED" });
    expect((await pool.query("SELECT title FROM episodes")).rows[0].title).toBe(episode.title);
    await service.resolveImportProposals(userId, pending.map((p) => p.id), "accept");
    const saved = (await pool.query("SELECT * FROM episodes")).rows[0];
    expect(saved.title).toBe(changed.title);
    expect(saved.duration_minutes).toBe(45);
    expect(saved.number_label).toBe("87");
    expect(saved.sort_order).toBe(87);
    expect(saved.priority_on_release).toBe(false);
    expect((await service.syncImportSource(sourceId, "manual", undefined, fetcher([changed])))?.changedItemCount).toBe(0);
  });

  it("verarbeitet 240 Änderungen gemeinsam und rollt bei einem Fehler die ganze Auswahl zurück", async () => {
    const service = await import("@/lib/online-import-service");
    const source = (await pool.query("SELECT series_id FROM import_sources WHERE id=$1", [sourceId])).rows[0];
    const run = (await pool.query("SELECT id FROM import_runs WHERE source_id=$1 LIMIT 1", [sourceId])).rows[0];
    const ids: string[] = [];
    for (let index = 0; index < 240; index++) {
      const key = `bulk-${index}`;
      const target = (await pool.query("INSERT INTO episodes(series_id,episode_key,title) VALUES ($1,$2,'Alter Titel') RETURNING id", [source.series_id, key])).rows[0];
      const payload = { ...episode, externalId: key, title: `Neuer Titel ${index}`, links: [] };
      await pool.query("INSERT INTO import_source_items(source_id,external_id,episode_id,payload_hash,source_payload) VALUES ($1,$2,$3,repeat('a',64),$4::jsonb)", [sourceId, key, target.id, JSON.stringify({ ...payload, title: "Alter Titel" })]);
      ids.push((await pool.query("INSERT INTO import_proposals(source_id,run_id,external_id,proposal_type,candidate_episode_id,payload_hash,source_payload) VALUES ($1,$2,$3,'update',$4,repeat('b',64),$5::jsonb) RETURNING id", [sourceId, run.id, key, target.id, JSON.stringify(payload)])).rows[0].id);
    }
    const last = (await pool.query("SELECT external_id FROM import_proposals WHERE id=$1", [ids.toSorted().at(-1)])).rows[0];
    await pool.query("DELETE FROM import_source_items WHERE source_id=$1 AND external_id=$2", [sourceId, last.external_id]);
    await expect(service.resolveImportProposals(userId, ids, "accept")).rejects.toMatchObject({ code: "MAPPING_MISSING" });
    expect((await pool.query("SELECT count(*)::int AS n FROM episodes WHERE title='Alter Titel'")).rows[0].n).toBe(240);
    expect((await pool.query("SELECT count(*)::int AS n FROM import_proposals WHERE id=ANY($1::uuid[]) AND status='pending'", [ids])).rows[0].n).toBe(240);
    await pool.query("INSERT INTO import_source_items(source_id,external_id,episode_id,payload_hash,source_payload) SELECT source_id,external_id,candidate_episode_id,payload_hash,source_payload FROM import_proposals WHERE id=$1", [ids.toSorted().at(-1)]);
    await service.resolveImportProposals(userId, ids, "accept");
    expect((await pool.query("SELECT count(*)::int AS n FROM episodes WHERE title LIKE 'Neuer Titel %'")).rows[0].n).toBe(240);
  });
});
