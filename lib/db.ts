import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getDatabaseUrl } from "@/lib/env";

declare global {
  var __hoerspielPool: Pool | undefined;
}

export function db(): Pool {
  if (!globalThis.__hoerspielPool) {
    globalThis.__hoerspielPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.DB_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalThis.__hoerspielPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await db().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function lockUser(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [userId]);
}
