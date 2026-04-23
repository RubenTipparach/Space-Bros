import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazily-constructed DB client. We don't read `DATABASE_URL` at module load
 * so builds that don't touch the DB (e.g. `next build` for a static page)
 * still succeed without the env var set.
 */

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Neon connection string.",
    );
  }
  _sql = postgres(url, {
    prepare: false, // Neon pooled endpoint compatibility
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  _db = drizzle(_sql, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
