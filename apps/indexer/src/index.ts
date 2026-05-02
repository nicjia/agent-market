import "dotenv/config";
import { ethers } from "ethers";
import { Pool } from "pg";
import { agentMarketAbi } from "@agent-market/contracts/abi";

type ParsedLog = {
  name: string;
  args: Record<string, unknown>;
};

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const databaseUrl = process.env.DATABASE_URL;
const indexerPollMs = Number(process.env.INDEXER_POLL_MS || 5000);

if (!rpcUrl || !contractAddress || !databaseUrl) {
  throw new Error("RPC_URL, CONTRACT_ADDRESS, and DATABASE_URL are required");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const contract = new ethers.Contract(contractAddress, agentMarketAbi, provider);
const pool = new Pool({ connectionString: databaseUrl });

async function getLastIndexedBlock(): Promise<number> {
  const result = await pool.query("select last_block from indexer_state order by id desc limit 1");
  if (result.rows.length === 0) {
    const latest = await provider.getBlockNumber();
    await pool.query("insert into indexer_state (last_block) values ($1)", [latest - 1]);
    return latest - 1;
  }
  return Number(result.rows[0].last_block);
}

async function setLastIndexedBlock(blockNumber: number) {
  await pool.query("insert into indexer_state (last_block) values ($1)", [blockNumber]);
}

function parseLog(log: ethers.Log): ParsedLog | null {
  try {
    const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
    return { name: parsed.name, args: parsed.args as unknown as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function upsertTaskFromEvent(eventName: string, args: Record<string, unknown>) {
  if (eventName === "TaskCreated") {
    await pool.query(
      "insert into tasks (task_id, schema_hash, schema_json, bounty_wei, challenge_fee_wei, ttl_seconds, requester, risk_tier, state) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (task_id) do nothing",
      [
        String(args.taskId),
        String(args.taskSchemaHash ?? ""),
        {},
        String(args.bounty),
        "0",
        Number(args.ttlSeconds ?? 0),
        String(args.requester),
        Number(args.riskTier ?? 0),
        "OPEN"
      ]
    );
  }

  if (eventName === "TaskLocked") {
    await pool.query(
      "update tasks set provider = $1, payload_hash = $2, payload_cid = $3, state = $4, updated_at = now() where task_id = $5",
      [String(args.provider), String(args.payloadHash), String(args.payloadCid), "TTL_COUNTDOWN", String(args.taskId)]
    );
  }

  if (eventName === "TaskChallenged") {
    await pool.query(
      "insert into disputes (task_id, status, challenge_fee_wei) values ($1, $2, $3)",
      [String(args.taskId), "active", String(args.challengeFee ?? "0")]
    );
    await pool.query(
      "update tasks set state = $1, updated_at = now() where task_id = $2",
      ["DISPUTE_ACTIVE", String(args.taskId)]
    );
  }

  if (eventName === "JurorRevealed") {
    await pool.query(
      "insert into juror_votes (task_id, juror, vote_valid, revealed) values ($1, $2, $3, $4) on conflict (task_id, juror) do update set vote_valid = excluded.vote_valid, revealed = excluded.revealed, updated_at = now()",
      [String(args.taskId), String(args.juror), Boolean(args.valid), true]
    );
  }

  if (eventName === "TaskSettled") {
    await pool.query(
      "update tasks set state = $1, updated_at = now() where task_id = $2",
      ["SETTLED", String(args.taskId)]
    );
    await pool.query(
      "update disputes set status = $1, updated_at = now() where task_id = $2",
      ["resolved", String(args.taskId)]
    );
  }
}

async function indexOnce() {
  const fromBlock = await getLastIndexedBlock();
  const latestBlock = await provider.getBlockNumber();
  if (latestBlock <= fromBlock) {
    return;
  }

  const logs = await provider.getLogs({
    address: contractAddress,
    fromBlock: fromBlock + 1,
    toBlock: latestBlock
  });

  for (const log of logs) {
    const parsed = parseLog(log);
    if (!parsed) continue;

    await pool.query(
      "insert into chain_events (block_number, tx_hash, log_index, event_name, payload) values ($1, $2, $3, $4, $5) on conflict (tx_hash, log_index) do nothing",
      [Number(log.blockNumber), log.transactionHash, Number(log.index), parsed.name, parsed.args]
    );

    await upsertTaskFromEvent(parsed.name, parsed.args);
  }

  await setLastIndexedBlock(latestBlock);
}

async function main() {
  await indexOnce();
  setInterval(() => {
    indexOnce().catch((err) => console.error(err));
  }, indexerPollMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
