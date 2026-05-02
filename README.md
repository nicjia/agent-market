# Agent Market

This repo implements a juried escrow marketplace with a 9-node consensus flow.

## Monorepo layout
- apps/api: Fastify API for task creation, challenge, and settlement
- apps/jury-worker: Juror orchestration worker calling LLM providers and voting on-chain
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

4) Run the API
   - pnpm --filter @agent-market/api dev

5) Run the jury worker
   - pnpm --filter @agent-market/jury-worker dev

6) Use the CLI
   - pnpm --filter @agent-market/cli dev --help

## Environment
Copy .env.example to .env and fill in values for RPC_URL, CONTRACT_ADDRESS, DATABASE_URL, private keys, and VRF settings.

## Notes
- Juror selection uses VRF and commit-reveal voting with a configurable delay.
- Challenge fees are dynamic based on bounty, requester dispute history, and risk tier.
- Payloads are referenced by content-addressed identifiers (CID) plus a payload hash.
- LLM calls are treated as juror operators; juror private keys represent those operators.
