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
# FR-01: 构建期 GIT_SHA 烙入（Gate3 SHA 对账）
# build: docker build --build-arg GIT_SHA=$(git rev-parse HEAD) ...
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
# v1.228.2 (2026-05-05): 加 docker-cli-compose（docker compose plugin）。
# 旧版只装 docker-cli → 缺 'docker compose' 子命令 → brain-deploy.sh 调
# `docker compose -f docker-compose.yml up -d` 报 "unknown shorthand flag: 'f' in -f"
# → webhook deploy 永久 fail。手动 host 跑 OK 因为 host 装了 compose plugin。
# 加 docker-cli-compose 让 container 内 docker compose 子命令可用。
# acl/attr：Kernel protected-path inspector 在 Linux runtime 必须完整枚举
# POSIX ACL 与 xattr；缺任一工具时按安全合同 fail-closed。
# postgresql-client (createdb/dropdb/psql)：WS1 预览闸 preview-env-start.sh 用
# `createdb -T cecelia cecelia_preview_<PR>` 克隆生产快照做数据隔离，容器内此前没装过，
# 实测(PR#3801) Step4 直接报 "createdb: command not found" 失败退出。
RUN apk add --no-cache curl bash jq procps tini docker-cli docker-cli-compose git openssh-client ca-certificates github-cli postgresql-client acl attr \
 && adduser -D -u 1001 cecelia

# Install Codex CLI globally so triggerCodexReview() in executor.js can spawn it.
# 历史事故：容器漏装 codex CLI → spawn ENOENT → cecelia-run breaker failures=351 OPEN
# → 阻断所有 dispatch（spec_review/code_review_gate/arch_review/initiative_review）。
# 容器内默认路径 /usr/local/bin/codex，由 docker-compose CODEX_BIN env 显式指定。
RUN npm install -g @openai/codex@0.145.0
COPY packages/brain/scripts/codex-review-uds-bridge.cjs /usr/local/libexec/codex-review-uds-bridge.cjs

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
# 预览环境用根 lock 对账分支依赖；没有这个不可变指纹时只能为每个 PR 重装依赖。
COPY --from=deps /repo/package.json /repo/package.json
COPY --from=deps /repo/package-lock.json /repo/package-lock.json
# 运行期仍走 /app（server.js 期待此路径），把 node_modules 也链到 /app
RUN ln -s /repo/node_modules /app/node_modules

# 源代码
COPY packages/brain/server.js ./
COPY packages/brain/src/ ./src/
COPY packages/brain/config/ ./config/
COPY packages/brain/migrations/ ./migrations/
COPY packages/brain/package.json ./
# Release effect controllers run as sibling containers so replacing Brain
# cannot kill their lease/readback/settlement process. Keep the entrypoints in
# the immutable image; rollback route code and compose definition are immutable
# too, while their data targets remain in the mounted deployment root.
COPY packages/brain/src/ /repo/packages/brain/src/
COPY packages/brain/package.json /repo/packages/brain/package.json
COPY scripts/lib/release-run-effect-worker.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-rollback-worker.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-worker-runtime.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-rollback-worker-runtime.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-production-lock.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-production-progress.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-artifact-snapshot.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-tree-digest.mjs /repo/scripts/lib/
COPY scripts/brain-rollback.sh /repo/scripts/
COPY scripts/promote-dashboard.sh /repo/scripts/
COPY scripts/lib/release-run-rollback-guard.sh /repo/scripts/lib/
COPY scripts/lib/verify-release-rollback-worker.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-tree-digest-cli.mjs /repo/scripts/lib/
COPY scripts/lib/release-run-dashboard-receipt.mjs /repo/scripts/lib/
COPY packages/workflows/scripts/deploy-workflow-skills.sh /repo/packages/workflows/scripts/
COPY docker-compose.yml /repo/docker-compose.yml
# `/app/src/**` 的 monorepo-relative production imports resolve 到根 `/scripts`.
# Release workers 仍以 `/repo/scripts` 作为 sibling-controller entrypoint；用唯一
# immutable alias 共享同一份 bytes，避免两份 runtime 漂移。
RUN ln -s /repo/scripts /scripts
# Brain 的 production seam builder 会加载 package-owned fleet-worker
# mutation broker；完整复制 scripts runtime，避免首个缺文件修好后继续在二级
# require/import 上启动失败。
COPY packages/brain/scripts/ ./scripts/
# Kernel DevGate seam 是跨 workspace 的生产依赖。它从 /engine 反向引用 /brain，
# 因此保留 /app 为唯一 Brain copy，以 immutable alias 提供 /brain 身份，并复制
# 完整 Engine package（包括 sidecar 的同目录 shell/CJS runtime），禁止单文件补洞。
COPY packages/engine/ /engine/
RUN ln -s /app /brain

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
