# cecelia-brain Docker image
# 从仓库根 (CONTEXT = ROOT) 构建，因为 monorepo 用 npm workspaces 把依赖 hoist 到根 node_modules
#
# 构建方式（见 scripts/brain-build.sh）:
#   docker build -t cecelia-brain:latest -f packages/brain/Dockerfile .
# （. = repo root，不是 packages/brain 子目录）

# ── Stage 1: Dependencies ──
FROM node:20-alpine AS deps
WORKDIR /repo
# 复制 workspace manifests
COPY package.json package-lock.json ./
COPY packages/brain/package.json packages/brain/
# 只装 brain 子 workspace 的生产依赖（ignore scripts 加速）
RUN npm ci --workspace=packages/brain --omit=dev --ignore-scripts

# ── Stage 2: Runtime ──
FROM node:20-alpine
RUN apk add --no-cache curl bash procps tini docker-cli git openssh-client ca-certificates github-cli \
 && adduser -D -u 1001 cecelia

WORKDIR /app

# npm workspaces hoist：deps 在根 node_modules，packages/brain/node_modules 有少量软链
# 把两处 node_modules 都拷过来（运行时 Node resolver 可以从 /repo/packages/brain/node_modules
# 向上找 /repo/node_modules）
COPY --from=deps /repo/node_modules /repo/node_modules
COPY --from=deps /repo/packages/brain/node_modules /repo/packages/brain/node_modules
# 运行期仍走 /app（server.js 期待此路径），把 node_modules 也链到 /app
RUN ln -s /repo/node_modules /app/node_modules

# 源代码
COPY packages/brain/server.js ./
COPY packages/brain/src/ ./src/
COPY packages/brain/migrations/ ./migrations/
COPY packages/brain/package.json ./

# Root user: 容器内需要访问 /var/run/docker.sock 调 dockerd spawn 兄弟容器。
# macOS 宿主没有 docker group，gid 映射不稳定；direct root 最简单。
# 安全边界由 docker-compose.yml 提供：read_only filesystem + 只读凭据挂载 + tmpfs /tmp 100M
USER root
# HOME=/Users/administrator：让 os.homedir() 和 docker-executor 生成的 mount 路径一致。
# compose 把宿主 /Users/administrator/.X 挂到容器内**同名**路径，
# 这样：
# - docker-executor 构造子容器 mount 时走宿主路径 → docker daemon 能解析
# - Brain 内部 os.homedir() 拼的路径 → 和容器内挂载点一致，existsSync 能过
ENV HOME=/Users/administrator

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5221/api/brain/tick/status || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "--max-old-space-size=3072", "server.js"]
