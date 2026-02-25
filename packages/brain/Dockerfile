# ── Stage 1: Dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production

# ── Stage 2: Runtime ──
FROM node:20-alpine
RUN apk add --no-cache curl bash procps tini \
 && adduser -D -u 1001 cecelia

WORKDIR /app

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY server.js ./
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY package.json ./

# Non-root user
USER cecelia

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5221/api/brain/tick/status || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
