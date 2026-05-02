import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { ethers } from "ethers";
import { TaskSchemaZod, SubmittedPayloadZod } from "@agent-market/schema";
import { agentMarketAbi } from "@agent-market/contracts/abi";

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const requesterKey = process.env.RA_PRIVATE_KEY;
const providerKey = process.env.PA_PRIVATE_KEY;
const ownerKey = process.env.OWNER_PRIVATE_KEY || requesterKey;
const jurorKey = process.env.JUROR_PRIVATE_KEY || ownerKey;

if (!rpcUrl || !contractAddress || !requesterKey || !providerKey || !ownerKey) {
  throw new Error("RPC_URL, CONTRACT_ADDRESS, RA_PRIVATE_KEY, PA_PRIVATE_KEY, and OWNER_PRIVATE_KEY are required");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const requesterWallet = new ethers.Wallet(requesterKey, provider);
const providerWallet = new ethers.Wallet(providerKey, provider);
const ownerWallet = new ethers.Wallet(ownerKey, provider);
const jurorWallet = new ethers.Wallet(jurorKey, provider);

const requesterContract = new ethers.Contract(contractAddress, agentMarketAbi, requesterWallet);
const providerContract = new ethers.Contract(contractAddress, agentMarketAbi, providerWallet);
const ownerContract = new ethers.Contract(contractAddress, agentMarketAbi, ownerWallet);
const jurorContract = new ethers.Contract(contractAddress, agentMarketAbi, jurorWallet);

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
  return ethers.keccak256(ethers.toUtf8Bytes(stableStringify(value)));
}

const program = new Command();

program
  .command("create-task")
  .requiredOption("-f, --file <path>")
  .requiredOption("-b, --bounty <wei>")
  .requiredOption("-t, --ttl <seconds>")
  .option("-r, --risk-tier <tier>")
  .action(async (opts) => {
    const raw = await readFile(opts.file, "utf-8");
    const schema = JSON.parse(raw);
    const parsed = TaskSchemaZod.safeParse(schema);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.flatten()));
    }

    const hash = hashJson(parsed.data);
    const riskTier = opts.riskTier ? Number(opts.riskTier) : parsed.data.riskTier ?? 0;
    const tx = await requesterContract.createTask(hash, opts.bounty, Number(opts.ttl), riskTier, {
      value: opts.bounty
    });
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
    console.log("taskId", taskId, "schemaHash", hash);
  });

program
  .command("submit")
  .requiredOption("-f, --file <path>")
  .requiredOption("-c, --payload-cid <cid>")
  .requiredOption("-s, --stake <wei>")
  .requiredOption("-i, --task-id <id>")
  .action(async (opts) => {
    const raw = await readFile(opts.file, "utf-8");
    const payload = JSON.parse(raw);

    const parsed = SubmittedPayloadZod.safeParse({
      taskId: opts.taskId,
      result: payload,
      evidence: {},
      provider: providerWallet.address
    });
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.flatten()));
    }

    const payloadHash = hashJson(parsed.data);
    const tx = await providerContract.acceptAndSubmit(opts.taskId, payloadHash, opts.payloadCid, {
      value: opts.stake
    });
    await tx.wait();

    console.log("submitted", opts.taskId, "payloadHash", payloadHash);
  });

program
  .command("challenge")
  .requiredOption("-i, --task-id <id>")
  .action(async (opts) => {
    const fee: bigint = await requesterContract.calculateChallengeFee(opts.taskId);
    const tx = await requesterContract.challenge(opts.taskId, { value: fee });
    await tx.wait();
    console.log("challenged", opts.taskId);
  });

program
  .command("challenge-fee")
  .requiredOption("-i, --task-id <id>")
  .action(async (opts) => {
    const fee: bigint = await requesterContract.calculateChallengeFee(opts.taskId);
    console.log("challengeFeeWei", fee.toString());
  });

program
  .command("settle")
  .requiredOption("-i, --task-id <id>")
  .action(async (opts) => {
    const tx = await requesterContract.settleAfterTTL(opts.taskId);
    await tx.wait();
    console.log("settled", opts.taskId);
  });

program
  .command("admin-set-vrf")
  .requiredOption("--key-hash <hash>")
  .requiredOption("--sub-id <id>")
  .option("--confirmations <n>")
  .option("--callback-gas <n>")
  .action(async (opts) => {
    const confirmations = opts.confirmations ? Number(opts.confirmations) : 3;
    const callbackGas = opts.callbackGas ? Number(opts.callbackGas) : 200000;
    const tx = await ownerContract.setVrfConfig(opts.keyHash, opts.subId, confirmations, callbackGas);
    await tx.wait();
    console.log("vrf config set");
  });

program
  .command("admin-set-fee")
  .requiredOption("--base-bps <n>")
  .requiredOption("--min-fee <wei>")
  .requiredOption("--max-loss-bps <n>")
  .action(async (opts) => {
    const tx = await ownerContract.setFeeConfig(Number(opts.baseBps), opts.minFee, Number(opts.maxLossBps));
    await tx.wait();
    console.log("fee config set");
  });

program
  .command("admin-set-dispute-windows")
  .requiredOption("--commit <seconds>")
  .requiredOption("--reveal <seconds>")
  .action(async (opts) => {
    const tx = await ownerContract.setDisputeWindows(Number(opts.commit), Number(opts.reveal));
    await tx.wait();
    console.log("dispute windows set");
  });

program
  .command("admin-set-juror-config")
  .requiredOption("--min-stake <wei>")
  .requiredOption("--slash-bps <n>")
  .requiredOption("--exit-delay <seconds>")
  .requiredOption("--max-tier <n>")
  .action(async (opts) => {
    const tx = await ownerContract.setJurorConfig(
      opts.minStake,
      Number(opts.slashBps),
      Number(opts.exitDelay),
      Number(opts.maxTier)
    );
    await tx.wait();
    console.log("juror config set");
  });

program
  .command("juror-register")
  .requiredOption("--stake <wei>")
  .action(async (opts) => {
    const tx = await jurorContract.registerJuror({ value: opts.stake });
    await tx.wait();
    console.log("juror registered", jurorWallet.address);
  });

program
  .command("juror-add-stake")
  .requiredOption("--stake <wei>")
  .action(async (opts) => {
    const tx = await jurorContract.addJurorStake({ value: opts.stake });
    await tx.wait();
    console.log("juror stake added", jurorWallet.address);
  });

program
  .command("juror-unregister")
  .action(async () => {
    const tx = await jurorContract.unregisterJuror();
    await tx.wait();
    console.log("juror unregistered", jurorWallet.address);
  });

program
  .command("juror-withdraw")
  .requiredOption("--amount <wei>")
  .action(async (opts) => {
    const tx = await jurorContract.withdrawJurorStake(opts.amount);
    await tx.wait();
    console.log("juror stake withdrawn", jurorWallet.address);
  });

program.parseAsync(process.argv);
