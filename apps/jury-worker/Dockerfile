FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY apps/jury-worker/package.json apps/jury-worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --filter @agent-market/jury-worker --filter @agent-market/contracts

COPY apps/jury-worker apps/jury-worker
COPY packages/contracts packages/contracts

WORKDIR /app/apps/jury-worker
RUN pnpm build

CMD ["pnpm", "start"]
