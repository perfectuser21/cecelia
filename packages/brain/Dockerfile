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
RUN npm ci --workspace=packages/brain --omit=dev --omit=optional --ignore-scripts

# ── Stage 2: Runtime ──
FROM node:20-alpine
# v1.228.2 (2026-05-05): 加 docker-cli-compose（docker compose plugin）。
# 旧版只装 docker-cli → 缺 'docker compose' 子命令 → brain-deploy.sh 调
# `docker compose -f docker-compose.yml up -d` 报 "unknown shorthand flag: 'f' in -f"
# → webhook deploy 永久 fail。手动 host 跑 OK 因为 host 装了 compose plugin。
# 加 docker-cli-compose 让 container 内 docker compose 子命令可用。
RUN apk add --no-cache curl bash procps tini docker-cli docker-cli-compose git openssh-client ca-certificates github-cli \
 && adduser -D -u 1001 cecelia

# Install gh CLI for shepherd.js (gh pr view/merge) and harness-watcher.js (gh run list).
# Use release tarball (not apk's github-cli, which lives in community repo and is less stable).
RUN GH_VERSION=2.45.0 \
 && wget -qO- https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz \
    | tar -xz -C /tmp \
 && mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh_${GH_VERSION}_linux_amd64

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
