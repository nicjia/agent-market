create table if not exists indexer_state (
  id serial primary key,
  last_block bigint not null
);

create table if not exists tasks (
  id serial primary key,
  task_id bigint not null unique,
  schema_hash text not null,
  schema_json jsonb not null,
  bounty_wei text not null,
  challenge_fee_wei text not null,
  ttl_seconds int not null,
  requester text not null,
  provider text,
  payload_hash text,
  payload_cid text,
  risk_tier int not null default 0,
  state text not null default 'OPEN',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists disputes (
  id serial primary key,
  task_id bigint not null references tasks(task_id),
  status text not null,
  challenge_fee_wei text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists juror_votes (
  id serial primary key,
  task_id bigint not null references tasks(task_id),
  juror text not null,
  vote_valid boolean,
  revealed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(task_id, juror)
);

create table if not exists chain_events (
  id serial primary key,
  block_number bigint not null,
  tx_hash text not null,
  log_index int not null,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  unique(tx_hash, log_index)
);
