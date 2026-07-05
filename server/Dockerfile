# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Install build tools needed for native addons (e.g. @discordjs/opus, libsodium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY package.json ./

# Uploads directory (mounted as volume in production)
RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "src/index.js"]
