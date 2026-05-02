import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString: databaseUrl });

export async function initDb() {
  await pool.query(
    "create table if not exists migrations (id serial primary key, name text unique, applied_at timestamptz default now())"
  );

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(currentDir, "..", "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const already = await pool.query("select 1 from migrations where name = $1", [file]);
    if (already.rowCount) continue;

    const sql = await readFile(join(migrationsDir, file), "utf-8");
    await pool.query("begin");
    await pool.query(sql);
    await pool.query("insert into migrations (name) values ($1)", [file]);
    await pool.query("commit");
  }
}
