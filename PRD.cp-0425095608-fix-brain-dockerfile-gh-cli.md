# PRD: Brain Dockerfile 装 gh CLI

**日期**：2026-04-25
**分支**：cp-0425095608-fix-brain-dockerfile-gh-cli
**Brain 任务**：29e87942-a306-4fed-884c-b62858df566e

## 问题

Harness v6 审计：Brain 容器镜像缺 gh CLI。

- `packages/brain/src/shepherd.js` 调 `gh pr view` / `gh pr merge` 轮询合并 open PR
- `packages/brain/src/harness-watcher.js` 调 `gh run list` 查 CI 状态

容器内执行 → `command not found` → auto-merge / CI 监控两条 Harness v6 关键链路全废。

## 方案

`packages/brain/Dockerfile` Stage 2 在现有 `apk add` 行下追加独立 RUN：下载 gh release tar，解压抽出 `gh` 二进制到 `/usr/local/bin/gh`。

```dockerfile
RUN GH_VERSION=2.45.0 \
 && wget -qO- https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz \
    | tar -xz -C /tmp \
 && mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh_${GH_VERSION}_linux_amd64
```

选 release tar 不选 `apk add github-cli`：alpine community repo 稳定性低、版本滞后；release tar 版本可控。base image `node:20-alpine` 默认带 wget，无需额外 apk add。

## 做

1. `packages/brain/Dockerfile` Stage 2 加 gh 安装 RUN
2. `docs/learnings/cp-0425095608-fix-brain-dockerfile-gh-cli.md`

## 不做

- 不改 shepherd.js / harness-watcher.js 业务逻辑
- 不改 docker-compose.yml
- 不为 gh 配 GH_TOKEN（运行时由 secrets 挂载，已存在）
- 不加单元测试（PRD 说不需要，BEHAVIOR 由本地 docker build + run 验证）

## 成功标准

- `packages/brain/Dockerfile` 含 `gh_${GH_VERSION}_linux_amd64.tar.gz` 下载行
- `packages/brain/Dockerfile` 含 `mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh`
- 本地 `docker build -t cecelia-brain:gh-test -f packages/brain/Dockerfile .` 成功（已验证）
- 本地 `docker run --rm cecelia-brain:gh-test command -v gh` → `/usr/local/bin/gh` exit 0（已验证）
- 本地 `docker run --rm cecelia-brain:gh-test gh --version` → `gh version 2.45.0` exit 0（已验证）
- Learning 文档存在
