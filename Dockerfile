# syntax=docker/dockerfile:1
# =============================================================================
# AgentStudio Docker Image - Multi-Runtime Support
# =============================================================================
#
# Single Dockerfile with two runtime targets:
#   - bun (default): Faster startup, lower memory
#   - node: Full Node.js compatibility
#
# Both targets share the same build stage (Node.js for Vite/TS compatibility).
#
# Usage:
#   # Default (Bun runtime):
#   docker build -t agentstudio .
#
#   # Node.js runtime:
#   docker build --target node -t agentstudio:node .
#
#   # Run:
#   docker run -d -p 4936:4936 -v ./data/home:/home/agentstudio agentstudio
#
# =============================================================================
# -----------------------------------------------------------------------------
# Stage 1: Build (shared, Node.js for Vite/TypeScript compatibility)
# -----------------------------------------------------------------------------
FROM node:20-slim AS builder

RUN echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile || pnpm install

COPY frontend ./frontend
COPY backend ./backend
COPY tsconfig.json ./

ENV NODE_OPTIONS="--max-old-space-size=3072"

RUN cd frontend && VITE_API_BASE=/api pnpm run build
RUN cd backend && pnpm run build

# -----------------------------------------------------------------------------
# Stage 2a: Node.js Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS node

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=ghcr.io/astral-sh/uv:latest /uvx /usr/local/bin/uvx

RUN echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    python3 \
    python3-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

ARG USER_ID=1000
ARG GROUP_ID=1000
RUN if [ "${USER_ID}" = "1000" ]; then \
        usermod -l agentstudio -d /home/agentstudio -m node && \
        groupmod -n agentstudio node; \
    else \
        groupadd -g ${GROUP_ID} agentstudio 2>/dev/null || true && \
        useradd -m -u ${USER_ID} -g ${GROUP_ID} -s /bin/bash agentstudio 2>/dev/null || true; \
    fi

WORKDIR /app

COPY --from=builder /build/package.json /build/pnpm-workspace.yaml /build/pnpm-lock.yaml* ./
COPY --from=builder /build/frontend/package.json ./frontend/
COPY --from=builder /build/backend/package.json ./backend/

WORKDIR /app/backend
RUN --mount=type=cache,id=pnpm-prod-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY --from=builder /build/frontend/dist /app/frontend/dist
COPY --from=builder /build/backend/dist /app/backend/dist

RUN mkdir -p /app/backend/public && \
    cp -r /app/frontend/dist/* /app/backend/public/

RUN mkdir -p /home/agentstudio/.agentstudio/{data,config,agents,run,scripts,slack-session-locks,scheduled-tasks} && \
    mkdir -p /home/agentstudio/.claude/projects && \
    chown -R agentstudio:agentstudio /home/agentstudio && \
    chown -R agentstudio:agentstudio /app

USER agentstudio

ENV NODE_ENV=production \
    PORT=4936 \
    HOST=0.0.0.0 \
    HOME=/home/agentstudio \
    TZ=Asia/Shanghai

WORKDIR /app/backend

EXPOSE 4936

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

CMD ["node", "dist/index.js"]

# -----------------------------------------------------------------------------
# Stage 2b: Bun Runtime (default)
# -----------------------------------------------------------------------------
FROM oven/bun:1-slim AS bun

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=ghcr.io/astral-sh/uv:latest /uvx /usr/local/bin/uvx

RUN echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ARG USER_ID=1000
ARG GROUP_ID=1000
RUN (groupadd -g ${GROUP_ID} agentstudio 2>/dev/null || groupmod -n agentstudio $(getent group ${GROUP_ID} | cut -d: -f1) 2>/dev/null || true) && \
    (useradd -m -u ${USER_ID} -g ${GROUP_ID} -s /bin/bash agentstudio 2>/dev/null || \
     (usermod -l agentstudio -d /home/agentstudio -m $(getent passwd ${USER_ID} | cut -d: -f1) 2>/dev/null && \
      mkdir -p /home/agentstudio && chown ${USER_ID}:${GROUP_ID} /home/agentstudio) || true)

WORKDIR /app

COPY --from=builder /build/package.json /build/pnpm-lock.yaml* ./
COPY --from=builder /build/frontend/package.json ./frontend/
COPY --from=builder /build/backend/package.json ./backend/

WORKDIR /app/backend
RUN --mount=type=cache,id=bun-cache,target=/home/bun/.bun/install/cache \
    bun install --production

COPY --from=builder /build/frontend/dist /app/frontend/dist
COPY --from=builder /build/backend/dist /app/backend/dist

RUN mkdir -p /app/backend/public && \
    cp -r /app/frontend/dist/* /app/backend/public/

RUN mkdir -p /home/agentstudio/.agentstudio/{data,config,agents,run,scripts,slack-session-locks,scheduled-tasks} && \
    mkdir -p /home/agentstudio/.claude/projects && \
    chown -R ${USER_ID}:${GROUP_ID} /home/agentstudio && \
    chown -R ${USER_ID}:${GROUP_ID} /app

USER agentstudio

ENV NODE_ENV=production \
    PORT=4936 \
    HOST=0.0.0.0 \
    HOME=/home/agentstudio \
    TZ=Asia/Shanghai

WORKDIR /app/backend

EXPOSE 4936

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

CMD ["bun", "run", "dist/index.js"]
