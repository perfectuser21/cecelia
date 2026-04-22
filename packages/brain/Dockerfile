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

# Root user: 容器内需要访问 /var/run/docker.sock 调 dockerd spawn 兄弟容器。
# macOS 宿主没有 docker group，gid 映射不稳定；direct root 最简单。
# 安全边界由 docker-compose.yml 提供：read_only filesystem + 只读凭据挂载 + tmpfs /tmp 100M
USER root

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5221/api/brain/tick/status || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "--max-old-space-size=3072", "server.js"]
