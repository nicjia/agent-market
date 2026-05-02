FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY apps/indexer/package.json apps/indexer/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --filter @agent-market/indexer --filter @agent-market/contracts

COPY apps/indexer apps/indexer
COPY packages/contracts packages/contracts

WORKDIR /app/apps/indexer
RUN pnpm build

CMD ["pnpm", "start"]
