# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build arg so the frontend knows where to reach the server at build time
ARG NEXT_PUBLIC_SERVER_URL=http://localhost:3001
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

RUN npm run build

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server.js"]
