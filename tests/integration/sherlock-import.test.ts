import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPLE_CATALOGS, appleCatalogUrl, parseAppleCatalog } from "@/lib/apple-catalog";

const databaseUrl = process.env.TEST_DATABASE_URL;
const catalogs = [
  { kind: "sherlock_original" as const, count: 65 },
  { kind: "sherlock_reloaded" as const, count: 55 },
  { kind: "sherlock_neue" as const, count: 60 },
];

describe.skipIf(!databaseUrl)("Sherlock-Holmes-Kataloge mit Datenbank", () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    if (!new URL(databaseUrl!).pathname.includes("test")) throw new Error("Testdatenbank erforderlich");
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(`migrations/${file}`, "utf8"));
    }
    userId = (await pool.query("INSERT INTO users(email,password_hash,role,catalog_baseline_date) VALUES ('sherlock@example.test','x','owner',current_date) RETURNING id")).rows[0].id;
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  it.each(catalogs)("legt $kind ohne URL an und importiert nach Bestätigung genau $count Folgen", async ({ kind, count }) => {
    const service = await import("@/lib/online-import-service");
    const seriesId = (await pool.query("INSERT INTO series(series_key,name) VALUES ($1,$1) RETURNING id", [kind])).rows[0].id;
    const sourceId = await service.createImportSource(userId, { seriesId, kind, name: kind });
    const feed = parseAppleCatalog(await readFile(`tests/fixtures/apple-${APPLE_CATALOGS[kind].artistId}.json`, "utf8"), kind);
    const fetcher = async () => ({ feed, notModified: false, etag: null, lastModified: null, finalUrl: appleCatalogUrl(kind) });

    const preview = await service.previewImportSource(sourceId, fetcher);
    expect(preview.run.status).toBe("awaiting_confirmation");
    expect(preview.proposals).toHaveLength(count);
    expect((await pool.query("SELECT id FROM episodes WHERE series_id=$1", [seriesId])).rows).toEqual([]);
    await service.commitImportPreview(userId, preview.run.id, preview.proposals.map((proposal) => ({ proposalId: proposal.id, action: "create" as const })));
    const saved = (await pool.query("SELECT number_label,title FROM episodes WHERE series_id=$1 ORDER BY sort_order", [seriesId])).rows;
    expect(saved).toHaveLength(count);
    expect(saved.map((episode) => episode.number_label)).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
    expect(saved[0].title).toBe(kind === "sherlock_neue" ? "Besuche eines Gehenkten" : "Das Haus bei den Blutbuchen");
    expect((await service.getImportSources()).find((source) => source.id === sourceId)).toMatchObject({ kind, url: null, confirmed: true, enabled: true });

    const unchanged = await service.syncImportSource(sourceId, "manual", undefined, fetcher);
    expect(unchanged).toMatchObject({ status: "succeeded", newItemCount: 0, changedItemCount: 0 });
    expect((await pool.query("SELECT id FROM episodes WHERE series_id=$1", [seriesId])).rowCount).toBe(count);
  });
});
