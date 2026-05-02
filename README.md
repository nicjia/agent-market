# Agent Market

This repo implements a juried escrow marketplace with a 9-node consensus flow.

## Monorepo layout
- apps/api: Fastify API for task creation, challenge, and settlement
- apps/jury-worker: Juror orchestration worker calling LLM providers and voting on-chain
- apps/indexer: Chain event indexer that updates the database
- apps/web: Read-only dashboard
- apps/cli: CLI for requester/provider flows
- packages/contracts: Solidity escrow and dispute contracts
- packages/schema: TaskSchema and payload validation

## Quick start
1) Install dependencies
   - pnpm install

2) Start Postgres
   - docker compose up -d

3) Deploy contracts (local dev or testnet)
   - pnpm --filter @agent-market/contracts compile
   - pnpm --filter @agent-market/contracts deploy

4) Run everything (API + indexer + jury worker + web)
   - pnpm dev

5) Or run individual services
   - pnpm --filter @agent-market/api dev
   - pnpm --filter @agent-market/jury-worker dev
   - pnpm --filter @agent-market/indexer dev
   - pnpm --filter @agent-market/web dev
   - pnpm --filter @agent-market/cli dev --help

## Local Hardhat testing
1) Start a local node
   - pnpm --filter @agent-market/contracts node

2) Deploy with VRF mock
   - pnpm --filter @agent-market/contracts deploy:local

3) Set RPC_URL in .env to http://127.0.0.1:8545 and CONTRACT_ADDRESS to the deploy output.

4) When a dispute is opened locally, fulfill VRF with:
   - VRF_REQUEST_ID=<requestId> CONTRACT_ADDRESS=<contract> VRF_COORDINATOR=<mock> pnpm --filter @agent-market/contracts fulfill:local

## Environment
Copy .env.example to .env and fill in values for RPC_URL, CONTRACT_ADDRESS, DATABASE_URL, private keys, and VRF settings.

## Notes
- Juror selection uses VRF and commit-reveal voting with a configurable delay.
- Challenge fees are dynamic based on bounty, requester dispute history, and risk tier.
- Payloads are referenced by content-addressed identifiers (CID) plus a payload hash.
- LLM calls are treated as juror operators; juror private keys represent those operators.

## API usage (trustless)
### Submit a raw signed transaction
```bash
curl -X POST http://localhost:3000/transactions/submit \
   -H "Content-Type: application/json" \
   -d '{"rawTx":"0x..."}'
```

### Ingest an on-chain transaction hash
```bash
curl -X POST http://localhost:3000/transactions/ingest \
   -H "Content-Type: application/json" \
   -d '{"txHash":"0x..."}'
```

### Attach TaskSchema JSON (verifies on-chain hash)
```bash
curl -X POST http://localhost:3000/tasks/1/schema \
   -H "Content-Type: application/json" \
   -d '{"taskSchema":{...}}'
```

### List tasks and states
```bash
curl http://localhost:3000/tasks
```

### Fetch juror votes for a task
```bash
curl http://localhost:3000/tasks/1/votes
```

## Deployment notes
- Dockerfiles are provided for API, indexer, and jury worker.
- Use a managed Postgres service and set DATABASE_URL accordingly.
- For testnet deploys: use deploy:base-sepolia or deploy:arbitrum-sepolia and verify with the matching verify script.
