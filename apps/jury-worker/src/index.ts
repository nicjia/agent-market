import "dotenv/config";
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";
import { agentMarketAbi } from "@agent-market/contracts/abi";

type JuryInput = {
  taskSchema: unknown;
  submittedPayload: unknown;
  taskId: number;
};

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const jurorKeys = (process.env.JUROR_PRIVATE_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
const jurorProviders = (process.env.JUROR_PROVIDERS || "").split(",").map((p) => p.trim()).filter(Boolean);

if (!rpcUrl || !contractAddress || jurorKeys.length === 0) {
  throw new Error("RPC_URL, CONTRACT_ADDRESS, and JUROR_PRIVATE_KEYS are required");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

function buildPrompt(taskSchema: unknown, submittedPayload: unknown) {
  return [
    "You are a juror. Decide if the SubmittedPayload strictly satisfies the TaskSchema acceptanceCriteria.",
    "Answer with a single digit: 1 if valid, 0 if invalid.",
    "TaskSchema:",
    JSON.stringify(taskSchema),
    "SubmittedPayload:",
    JSON.stringify(submittedPayload)
  ].join("\n");
}

async function callOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for openai provider");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "Return only 1 or 0." },
        { role: "user", content: prompt }
      ],
      temperature: 0
    })
  });

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return text;
}

async function callAnthropic(prompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for anthropic provider");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
      max_tokens: 8,
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const json = await res.json();
  const text = json?.content?.[0]?.text ?? "";
  return text;
}

function parseVote(text: string): 0 | 1 {
  const match = text.match(/(^|\D)([01])(\D|$)/);
  if (!match) return 0;
  return match[2] === "1" ? 1 : 0;
}

async function getVote(providerName: string, prompt: string): Promise<0 | 1> {
  if (providerName === "openai") {
    return parseVote(await callOpenAI(prompt));
  }
  if (providerName === "anthropic") {
    return parseVote(await callAnthropic(prompt));
  }
  return 0;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Provide path to jury input JSON file as the first argument");
  }

  const raw = await readFile(inputPath, "utf-8");
  const data = JSON.parse(raw) as JuryInput;
  const prompt = buildPrompt(data.taskSchema, data.submittedPayload);

  const providers = jurorProviders.length > 0 ? jurorProviders : Array(jurorKeys.length).fill("openai");

  const commitPlans: Array<{ wallet: ethers.Wallet; contract: ethers.Contract; vote: boolean; salt: string }> = [];

  for (let i = 0; i < jurorKeys.length; i++) {
    const key = jurorKeys[i];
    const jurorWallet = new ethers.Wallet(key, provider);
    const contract = new ethers.Contract(contractAddress, agentMarketAbi, jurorWallet);
    const providerName = providers[i % providers.length];
    const vote = await getVote(providerName, prompt);
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commitHash = ethers.solidityPackedKeccak256(
      ["uint256", "bool", "bytes32", "address"],
      [data.taskId, vote === 1, salt, jurorWallet.address]
    );

    const commitTx = await contract.commitVote(data.taskId, commitHash);
    await commitTx.wait();
    console.log(`Juror ${jurorWallet.address} committed ${vote}`);

    commitPlans.push({ wallet: jurorWallet, contract, vote: vote === 1, salt });
  }

  const delaySecondsEnv = process.env.JURY_REVEAL_DELAY_SECONDS;
  let delaySeconds = delaySecondsEnv ? Number(delaySecondsEnv) : 0;
  if (!delaySeconds) {
    const sampleContract = commitPlans[0]?.contract;
    if (sampleContract) {
      const commitWindow = await sampleContract.commitPeriodSeconds();
      delaySeconds = Number(commitWindow);
    }
  }

  if (delaySeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }

  for (const plan of commitPlans) {
    const revealTx = await plan.contract.revealVote(data.taskId, plan.vote, plan.salt);
    await revealTx.wait();
    console.log(`Juror ${plan.wallet.address} revealed ${plan.vote ? 1 : 0}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
