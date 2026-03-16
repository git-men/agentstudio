FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends curl wget && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /app

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY extension-pure/package.json ./extension-pure/

RUN pnpm install --frozen-lockfile --filter agentstudio-backend...

FROM base AS runner

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/frontend/package.json ./frontend/package.json
COPY --from=deps /app/extension-pure/package.json ./extension-pure/package.json

COPY backend/ ./backend/

RUN mkdir -p /tmp/e2e-test-project

ENV NODE_ENV=test
ENV NO_AUTH=true
ENV PORT=4936
ENV HOST=0.0.0.0

EXPOSE 4936

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD curl -f http://localhost:4936/api/health || exit 1

WORKDIR /app/backend
CMD ["npx", "tsx", "src/index.ts"]
