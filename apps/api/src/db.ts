import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString: databaseUrl });

export async function initDb() {
  await pool.query(`
    create table if not exists tasks (
      id serial primary key,
      task_id bigint not null,
      schema_hash text not null,
      schema_json jsonb not null,
      bounty_wei text not null,
      challenge_fee_wei text not null,
      ttl_seconds int not null,
      requester text not null,
      risk_tier int not null default 0,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    alter table tasks add column if not exists risk_tier int not null default 0;
  `);

  await pool.query(`
    create table if not exists disputes (
      id serial primary key,
      task_id bigint not null,
      status text not null,
      created_at timestamptz default now()
    );
  `);
}
