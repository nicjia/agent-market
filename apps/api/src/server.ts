import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ethers } from "ethers";
import { TaskSchemaZod, SubmittedPayloadZod } from "@agent-market/schema";
import { agentMarketAbi } from "@agent-market/contracts/abi";
import { initDb, pool } from "./db";

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const requesterKey = process.env.RA_PRIVATE_KEY;
const providerKey = process.env.PA_PRIVATE_KEY;

if (!rpcUrl || !contractAddress) {
  throw new Error("RPC_URL and CONTRACT_ADDRESS are required");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const requesterWallet = requesterKey ? new ethers.Wallet(requesterKey, provider) : null;
const providerWallet = providerKey ? new ethers.Wallet(providerKey, provider) : null;

const requesterContract = requesterWallet
  ? new ethers.Contract(contractAddress, agentMarketAbi, requesterWallet)
  : null;
const providerContract = providerWallet
  ? new ethers.Contract(contractAddress, agentMarketAbi, providerWallet)
  : null;
const readContract = new ethers.Contract(contractAddress, agentMarketAbi, provider);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown): string {
  const canonical = stableStringify(value);
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true
});

app.post("/tasks", async (request, reply) => {
  if (!requesterContract || !requesterWallet) {
    return reply.code(400).send({ error: "Signer not configured. Submit a transaction and call /transactions/ingest." });
  }
  const body = request.body as {
    taskSchema: unknown;
    bountyWei: string;
    ttlSeconds: number;
    riskTier?: number;
  };

  const parsed = TaskSchemaZod.safeParse(body.taskSchema);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const schemaHash = hashJson(parsed.data);
  const riskTier = body.riskTier ?? parsed.data.riskTier ?? 0;
  const tx = await requesterContract.createTask(
    schemaHash,
    body.bountyWei,
    body.ttlSeconds,
    riskTier,
    { value: body.bountyWei }
  );
  const receipt = await tx.wait();

  const event = receipt?.logs
    .map((log: { topics: string[]; data: string }) => {
      try {
        return requesterContract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsedLog) => parsedLog?.name === "TaskCreated");

  const taskId = event?.args?.taskId?.toString();
  if (!taskId) {
    return reply.code(500).send({ error: "TaskCreated event not found" });
  }

  await pool.query(
    "insert into tasks (task_id, schema_hash, schema_json, bounty_wei, challenge_fee_wei, ttl_seconds, requester, risk_tier) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [taskId, schemaHash, parsed.data, body.bountyWei, "0", body.ttlSeconds, requesterWallet.address, riskTier]
  );

  return reply.send({ taskId, schemaHash });
});

app.post("/tasks/:taskId/submit", async (request, reply) => {
  if (!providerContract || !providerWallet) {
    return reply.code(400).send({ error: "Signer not configured. Submit a transaction and call /transactions/ingest." });
  }
  const { taskId } = request.params as { taskId: string };
  const body = request.body as {
    payload: unknown;
    payloadCid: string;
    providerStakeWei: string;
  };

  const parsed = SubmittedPayloadZod.safeParse({
    taskId,
    result: body.payload,
    evidence: {},
    provider: providerWallet.address
  });

  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const payloadHash = hashJson(parsed.data);
  const tx = await providerContract.acceptAndSubmit(taskId, payloadHash, body.payloadCid, {
    value: body.providerStakeWei
  });
  await tx.wait();

  return reply.send({ taskId, payloadHash });
});

app.post("/tasks/:taskId/challenge", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  if (!requesterContract) {
    return reply.code(400).send({ error: "Signer not configured. Submit a transaction and call /transactions/ingest." });
  }
  const fee: bigint = await requesterContract.calculateChallengeFee(taskId);
  const tx = await requesterContract.challenge(taskId, { value: fee });
  await tx.wait();

  await pool.query("insert into disputes (task_id, status) values ($1, $2)", [taskId, "active"]);

  return reply.send({ taskId, status: "challenged" });
});

app.get("/tasks/:taskId/challenge-fee", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  const fee: bigint = await requesterContract.calculateChallengeFee(taskId);
  return reply.send({ taskId, challengeFeeWei: fee.toString() });
});

app.post("/tasks/:taskId/settle", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  if (!requesterContract) {
    return reply.code(400).send({ error: "Signer not configured. Submit a transaction and call /transactions/ingest." });
  }
  const tx = await requesterContract.settleAfterTTL(taskId);
  await tx.wait();

  return reply.send({ taskId, status: "settled" });
});

app.get("/health", async () => ({ ok: true }));

app.post("/transactions/ingest", async (request, reply) => {
  const body = request.body as { txHash: string };
  const receipt = await provider.getTransactionReceipt(body.txHash);
  if (!receipt) {
    return reply.code(404).send({ error: "Transaction not found" });
  }

  const events = receipt.logs
    .map((log) => {
      try {
        return readContract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return reply.send({ txHash: body.txHash, events });
});

app.post("/transactions/submit", async (request, reply) => {
  const body = request.body as { rawTx: string };
  const tx = await provider.broadcastTransaction(body.rawTx);
  const receipt = await tx.wait();

  const events = receipt.logs
    .map((log) => {
      try {
        return readContract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return reply.send({ txHash: receipt.hash, events });
});

app.get("/tasks", async (request, reply) => {
  const status = (request.query as { status?: string }).status;
  const result = status
    ? await pool.query("select task_id as \"taskId\", bounty_wei as \"bountyWei\", state, risk_tier as \"riskTier\" from tasks where state = $1 order by task_id desc", [status])
    : await pool.query("select task_id as \"taskId\", bounty_wei as \"bountyWei\", state, risk_tier as \"riskTier\" from tasks order by task_id desc");

  return reply.send({ tasks: result.rows });
});

app.get("/tasks/:taskId", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  const result = await pool.query("select * from tasks where task_id = $1", [taskId]);
  if (result.rows.length === 0) {
    return reply.code(404).send({ error: "Task not found" });
  }
  return reply.send({ task: result.rows[0] });
});

app.post("/tasks/:taskId/schema", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  const body = request.body as { taskSchema: unknown };
  const parsed = TaskSchemaZod.safeParse(body.taskSchema);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const schemaHash = hashJson(parsed.data);
  const result = await pool.query("select schema_hash from tasks where task_id = $1", [taskId]);
  if (result.rows.length === 0) {
    return reply.code(404).send({ error: "Task not found" });
  }

  if (result.rows[0].schema_hash !== schemaHash) {
    return reply.code(400).send({ error: "Schema hash mismatch" });
  }

  await pool.query("update tasks set schema_json = $1, updated_at = now() where task_id = $2", [parsed.data, taskId]);
  return reply.send({ taskId, status: "schema_saved" });
});

app.get("/tasks/:taskId/votes", async (request, reply) => {
  const { taskId } = request.params as { taskId: string };
  const result = await pool.query(
    "select juror, vote_valid as \"voteValid\", revealed from juror_votes where task_id = $1 order by id",
    [taskId]
  );
  return reply.send({ votes: result.rows });
});

await initDb();
app.listen({ port: 3000, host: "0.0.0.0" });
