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
#     -e CECELIA_TASK_ID=... \
#     cecelia/runner:latest \
#     "$prompt_text"
#
# 入口接收 prompt 作为 ENTRYPOINT 后续 argv，启动 claude，输出 JSON 到 stdout。

FROM node:20-slim

# 基础工具：bash/curl/git/jq/ca-certificates
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bash \
       ca-certificates \
       curl \
       git \
       jq \
       openssh-client \
  && rm -rf /var/lib/apt/lists/*

# 安装 Claude Code CLI
# 优先官方安装脚本，失败时 fallback 到 npm 全局安装
RUN (curl -fsSL https://claude.ai/install.sh | sh) \
    || npm install -g @anthropic-ai/claude-code \
    || true

# 工作目录：宿主 worktree 通过 -v 挂载到 /workspace
WORKDIR /workspace

# Headless 标志，下游脚本与 Stop Hook 据此跳过 TTY 检查
ENV CECELIA_HEADLESS=true \
    CECELIA_DOCKER_SANDBOX=true \
    NODE_NO_WARNINGS=1

# Healthcheck：claude 二进制是否就绪（buildtime 失败时仍允许构建，运行时再判定）
HEALTHCHECK --interval=30s --timeout=5s --retries=2 CMD command -v claude >/dev/null 2>&1 || exit 1

# Entry：claude headless 模式，prompt 由 docker run 末尾参数传入
# 输出 JSON 到 stdout，由 docker-executor.js 捕获
ENTRYPOINT ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json"]
