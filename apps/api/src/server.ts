import "dotenv/config";
import Fastify from "fastify";
import { ethers } from "ethers";
import { TaskSchemaZod, SubmittedPayloadZod } from "@agent-market/schema";
import { agentMarketAbi } from "@agent-market/contracts/abi";
import { initDb, pool } from "./db";

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const requesterKey = process.env.RA_PRIVATE_KEY;
const providerKey = process.env.PA_PRIVATE_KEY;

if (!rpcUrl || !contractAddress || !requesterKey || !providerKey) {
  throw new Error("RPC_URL, CONTRACT_ADDRESS, RA_PRIVATE_KEY, and PA_PRIVATE_KEY are required");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const requesterWallet = new ethers.Wallet(requesterKey, provider);
const providerWallet = new ethers.Wallet(providerKey, provider);

const requesterContract = new ethers.Contract(contractAddress, agentMarketAbi, requesterWallet);
const providerContract = new ethers.Contract(contractAddress, agentMarketAbi, providerWallet);

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

app.post("/tasks", async (request, reply) => {
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
  const tx = await requesterContract.settleAfterTTL(taskId);
  await tx.wait();

  return reply.send({ taskId, status: "settled" });
});

app.get("/health", async () => ({ ok: true }));

await initDb();
app.listen({ port: 3000, host: "0.0.0.0" });
