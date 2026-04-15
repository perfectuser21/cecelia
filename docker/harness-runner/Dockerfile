# Cecelia Harness Runner — Docker 沙箱镜像
# 用于在隔离容器中执行 harness task（claude -p 命令）
# 构建: docker build -t cecelia-harness-runner docker/harness-runner/

FROM node:20-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    procps \
    jq \
    bash \
    && rm -rf /var/lib/apt/lists/*

# 安装 claude CLI（全局，供容器内任务调用）
RUN npm install -g @anthropic-ai/claude-code

# 验证 claude CLI 已安装
RUN claude --version || true

# 创建非 root 用户运行任务（安全隔离）
RUN useradd -m -s /bin/bash runner

# 工作目录
WORKDIR /workspace
RUN chown runner:runner /workspace

# 切换到非 root 用户
USER runner

# 默认入口：由 cecelia-run.sh 覆盖为实际 claude -p 命令
CMD ["bash"]
