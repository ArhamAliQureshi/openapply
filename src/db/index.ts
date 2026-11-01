import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL set → real Postgres (Supabase/Neon/Docker, must have pgvector).
// Unset → embedded PGlite (Postgres in WASM, with pgvector) stored in ./.data.

const migrationsFolder = path.join(process.cwd(), "drizzle");

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 5 });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    return db;
  }
  const dataDir = path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir, {
    extensions: { vector },
  });
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}

// Survive Next dev hot reloads: one connection and one migration run per process.
const globalForDb = globalThis as unknown as { dbPromise?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.dbPromise ??= init().catch((err) => {
    globalForDb.dbPromise = undefined; // allow a retry on the next request
    throw err;
  });
  return globalForDb.dbPromise;
}

export { schema };
