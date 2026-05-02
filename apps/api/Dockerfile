FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/schema/package.json packages/schema/package.json

RUN pnpm install --filter @agent-market/api --filter @agent-market/contracts --filter @agent-market/schema

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/schema packages/schema

WORKDIR /app/apps/api
RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]
