import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimPlayback, getPlaybackProgress, savePlaybackProgress } from "@/lib/playback";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("geräteübergreifende Hörposition mit PostgreSQL", () => {
  let pool: Pool;
  let userId: string;
  let otherUserId: string;
  let episodeId: string;
  const save = (sessionId: string, sequence: number, positionSeconds: number, finished = false) => savePlaybackProgress(userId, episodeId, {
    sessionId, sequence, positionSeconds, durationSeconds: 3600, finished,
  });

  beforeAll(async () => {
    if (!new URL(databaseUrl!).pathname.toLowerCase().includes("test")) throw new Error("Eine Testdatenbank ist erforderlich.");
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(`migrations/${file}`, "utf8"));
    }
    const users = await pool.query<{ id: string }>(
      "INSERT INTO users (email,password_hash,catalog_baseline_date) VALUES ('playback@example.com','x',current_date), ('other@example.com','x',current_date) RETURNING id",
    );
    [userId, otherUserId] = users.rows.map((row) => row.id);
    const series = await pool.query<{ id: string }>("INSERT INTO series (series_key,name) VALUES ('playback','Originale') RETURNING id");
    const episode = await pool.query<{ id: string }>("INSERT INTO episodes (series_id,episode_key,title) VALUES ($1,'001','Testaufnahme') RETURNING id", [series.rows[0].id]);
    episodeId = episode.rows[0].id;
  });
  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db().end();
    await pool.end();
  });

  it("beginnt bei null und stellt die gespeicherte Position auf einem zweiten Gerät wieder her", async () => {
    expect(await getPlaybackProgress(userId, episodeId)).toEqual({ positionSeconds: 0, durationSeconds: null, updatedAt: null });
    const first = randomUUID();
    await claimPlayback(userId, episodeId, first);
    await save(first, 1, 125.75);
    const second = await claimPlayback(userId, episodeId, randomUUID());
    expect(second.positionSeconds).toBe(125.75);
    expect(second.durationSeconds).toBe(3600);
    expect(second.updatedAt).toBeTruthy();
  });

  it("verhindert alte Schreibzugriffe auch nach der Rückkehr zu einem früheren Gerät", async () => {
    const first = randomUUID(), second = randomUUID(), third = randomUUID();
    await claimPlayback(userId, episodeId, first);
    await save(first, 1, 200);
    await claimPlayback(userId, episodeId, second);
    await save(second, 1, 300);
    await expect(save(first, 100, 220)).rejects.toMatchObject({ code: "PLAYBACK_REPLACED" });
    expect((await claimPlayback(userId, episodeId, third)).positionSeconds).toBe(300);
    await save(third, 1, 350);
    await expect(save(second, 100, 500)).rejects.toMatchObject({ code: "PLAYBACK_REPLACED" });
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(350);
  });

  it("ordnet parallele Saves nach Sequenz und erlaubt bewusstes Zurückspulen", async () => {
    const session = randomUUID();
    await claimPlayback(userId, episodeId, session);
    await Promise.all(Array.from({ length: 20 }, (_, index) => save(session, index + 1, 500 + index)));
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(519);
    await save(session, 21, 10);
    await save(session, 19, 999);
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(10);
  });

  it("behält bei wiederholtem Übernehmen derselben Sitzung die Save-Sequenz", async () => {
    const session = randomUUID();
    await claimPlayback(userId, episodeId, session);
    await save(session, 10, 1000);
    expect((await claimPlayback(userId, episodeId, session)).positionSeconds).toBe(1000);
    await save(session, 1, 2);
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(1000);
  });

  it("trennt Benutzer auch bei gleicher Folge und gleicher Sitzungskennung", async () => {
    const session = randomUUID();
    await claimPlayback(userId, episodeId, session);
    await save(session, 1, 42);
    expect((await getPlaybackProgress(otherUserId, episodeId)).positionSeconds).toBe(0);
    await expect(savePlaybackProgress(otherUserId, episodeId, { sessionId: session, sequence: 2, positionSeconds: 99, durationSeconds: 3600, finished: false })).rejects.toMatchObject({ code: "PLAYBACK_REPLACED" });
    await claimPlayback(otherUserId, episodeId, session);
    await savePlaybackProgress(otherUserId, episodeId, { sessionId: session, sequence: 1, positionSeconds: 99, durationSeconds: 3600, finished: false });
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(42);
  });

  it("startet eine beendete Aufnahme beim nächsten Mal von vorn ohne den Gehört-Status zu ändern", async () => {
    const session = randomUUID();
    await claimPlayback(userId, episodeId, session);
    await save(session, 1, 3600, true);
    expect((await getPlaybackProgress(userId, episodeId)).positionSeconds).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM episode_completions WHERE user_id = $1", [userId])).rows[0].count).toBe(0);
  });

  it("entfernt die Position beim Löschen einer Folge", async () => {
    await pool.query("DELETE FROM episodes WHERE id = $1", [episodeId]);
    expect((await pool.query("SELECT count(*)::int AS count FROM user_episode_playback")).rows[0].count).toBe(0);
  });
});
