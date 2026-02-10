# =============================================================================
# AgentStudio Docker Image - Bun Runtime (Hybrid Build)
# =============================================================================
# This Dockerfile uses:
#   - Node.js for building (better compatibility with Vite)
#   - Bun for running (faster startup, lower memory)
# 
# Benefits:
#   - Faster startup time with Bun runtime
#   - Full compatibility with build tools (Vite, TypeScript)
#   - Lower memory usage in production
#
# Usage:
#   docker build -f Dockerfile.bun -t agentstudio:bun .
#   docker run -d -p 4936:4936 -v ./data/home:/home/agentstudio agentstudio:bun
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage (Node.js for compatibility)
# -----------------------------------------------------------------------------
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y \
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

RUN pnpm install --frozen-lockfile || pnpm install

COPY frontend ./frontend
COPY backend ./backend
COPY tsconfig.json ./

ENV NODE_OPTIONS="--max-old-space-size=3072"

RUN cd frontend && pnpm run build
RUN cd backend && pnpm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Stage (Bun for performance)
# -----------------------------------------------------------------------------
FROM oven/bun:1-slim AS production

RUN apt-get update && apt-get install -y \
    curl \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
# oven/bun:1-slim may have existing users, handle gracefully
ARG USER_ID=1000
ARG GROUP_ID=1000
RUN (groupadd -g ${GROUP_ID} agentstudio 2>/dev/null || groupmod -n agentstudio $(getent group ${GROUP_ID} | cut -d: -f1) 2>/dev/null || true) && \
    (useradd -m -u ${USER_ID} -g ${GROUP_ID} -s /bin/bash agentstudio 2>/dev/null || \
     (usermod -l agentstudio -d /home/agentstudio -m $(getent passwd ${USER_ID} | cut -d: -f1) 2>/dev/null && \
      mkdir -p /home/agentstudio && chown ${USER_ID}:${GROUP_ID} /home/agentstudio) || true)

WORKDIR /app

# Copy package files
COPY --from=builder /build/package.json /build/pnpm-lock.yaml* ./
COPY --from=builder /build/frontend/package.json ./frontend/
COPY --from=builder /build/backend/package.json ./backend/

# Copy built artifacts
COPY --from=builder /build/frontend/dist ./frontend/dist
COPY --from=builder /build/backend/dist ./backend/dist

# Install production dependencies with Bun
WORKDIR /app/backend
RUN bun install --production

# Setup frontend static files
RUN mkdir -p /app/backend/public && \
    cp -r /app/frontend/dist/* /app/backend/public/

# Create data directories (use UID/GID instead of username for reliability)
RUN mkdir -p /home/agentstudio/.agentstudio/{data,config,agents,run,scripts,slack-session-locks,scheduled-tasks} && \
    mkdir -p /home/agentstudio/.claude/projects && \
    chown -R ${USER_ID}:${GROUP_ID} /home/agentstudio && \
    chown -R ${USER_ID}:${GROUP_ID} /app

USER agentstudio

ENV NODE_ENV=production \
    PORT=4936 \
    HOME=/home/agentstudio

WORKDIR /app/backend

EXPOSE 4936

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Run with Bun (faster startup, lower memory)
CMD ["bun", "run", "dist/index.js"]
