# Cecelia Runner — Docker sandbox per task
#
# 替代 cecelia-run.sh + worktree spawn 的脆弱模式。
# 每个 task 一个隔离的容器，--rm 自动销毁，资源 cgroup 限制。
#
# 用法：
#   docker run --rm \
#     --memory=1g --cpus=1 \
#     --name=cecelia-task-{shortId} \
#     -v $WORKTREE:/workspace \
#     -v $HOST_CLAUDE:/host-claude-config:ro \
#     -v ~/.gitconfig:/home/cecelia/.gitconfig:ro \
#     -v ~/.config/gh:/home/cecelia/.config/gh:ro \
#     -e CECELIA_TASK_ID=... \
#     cecelia/runner:latest \
#     "$prompt_text"
#
# entrypoint.sh 负责：
#   1. 复制 /host-claude-config → /home/cecelia/.claude（可写，让 claude 写 session-env）
#   2. git config --global safe.directory '*'（信任宿主 worktree）
#   3. 启动 claude -p --dangerously-skip-permissions --output-format json

FROM node:20-slim

# 基础工具：bash/curl/git/jq/ssh/gh
# gh 官方 Debian 源：https://cli.github.com/manual/installation
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bash \
       ca-certificates \
       curl \
       git \
       gnupg \
       jq \
       openssh-client \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# 安装 Claude Code CLI
# 优先官方安装脚本，失败时 fallback 到 npm 全局安装
RUN (curl -fsSL https://claude.ai/install.sh | sh) \
    || npm install -g @anthropic-ai/claude-code \
    || true

# V6 图生成依赖 — 全局装 linux 版 @resvg/resvg-js
# 用途：content pipeline generate 节点调 ~/claude-output/scripts/gen-v6-person.mjs
# 渲染 9 张卡片 PNG。宿主 node_modules 是 Mac darwin-arm64 二进制，容器 Linux 无法加载。
RUN npm install -g @resvg/resvg-js

# 非 root 用户 — Claude Code 拒绝 root + --dangerously-skip-permissions
RUN groupadd -r cecelia && useradd -r -g cecelia -m -d /home/cecelia -s /bin/bash cecelia

# V6 运行时目录（容器内副本，避开挂载的 Mac node_modules）
# 原因：~/claude-output/scripts/node_modules/@resvg 是 darwin-arm64 Mac 二进制，
# Linux 容器加载会 ERR_MODULE_NOT_FOUND。ESM import 不认 NODE_PATH，必须在脚本
# 所在目录的 node_modules/ 下找 linux 版 resvg。此目录预置 symlink 指向
# Dockerfile 全局装的 linux @resvg/resvg-js；entrypoint 启动时 cp V6 脚本源码进来。
RUN mkdir -p /home/cecelia/v6-runtime/node_modules/@resvg \
  && ln -sf /usr/local/lib/node_modules/@resvg/resvg-js /home/cecelia/v6-runtime/node_modules/@resvg/resvg-js \
  && chown -R cecelia:cecelia /home/cecelia/v6-runtime

# 入口脚本：复制 host-claude-config → 可写副本 + safe.directory + 启动 claude
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /home/cecelia/.claude /home/cecelia/.config/gh \
  && chown -R cecelia:cecelia /home/cecelia

# 工作目录：宿主 worktree 通过 -v 挂载到 /workspace
WORKDIR /workspace

# Headless 标志，下游脚本与 Stop Hook 据此跳过 TTY 检查
# 默认 CLAUDE_CONFIG_DIR 指向可写副本；docker-executor 会显式注入同一值以保证一致性
# NODE_PATH 让 node --import resolve 到 `npm install -g` 装的全局模块（@resvg/resvg-js 等）
ENV CECELIA_HEADLESS=true \
    CECELIA_DOCKER_SANDBOX=true \
    NODE_NO_WARNINGS=1 \
    NODE_PATH=/usr/local/lib/node_modules \
    CLAUDE_CONFIG_DIR=/home/cecelia/.claude \
    HOME=/home/cecelia

# 切到非 root（必须在 ENV 之后）
USER cecelia

# Healthcheck：claude 二进制是否就绪（buildtime 失败时仍允许构建，运行时再判定）
HEALTHCHECK --interval=30s --timeout=5s --retries=2 CMD command -v claude >/dev/null 2>&1 || exit 1

# Entry：entrypoint.sh 执行配置复制 + safe.directory + exec claude
# prompt 由 docker run 末尾参数传入，以 "$@" 透传给 claude
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
