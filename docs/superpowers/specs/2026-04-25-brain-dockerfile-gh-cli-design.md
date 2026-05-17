# Brain Dockerfile 装 gh CLI（设计）

## 背景

Harness v6 审计：Brain 容器镜像缺少 `gh` CLI。

- `packages/brain/src/shepherd.js` 调 `gh pr view` / `gh pr merge` 轮询合并 open PR
- `packages/brain/src/harness-watcher.js` 调 `gh run list` 查 CI 状态

容器内执行 → `command not found` → auto-merge / CI 监控全废。

## 目标

`packages/brain/Dockerfile` Stage 2 装 gh CLI，让 shepherd / harness-watcher 链路恢复。

## 方案

下载 gh release tar 解压到 `/usr/local/bin/gh`（PRD 推荐方案 2，比 apk add github-cli 稳定）：

```dockerfile
RUN GH_VERSION=2.45.0 \
 && wget -qO- https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz \
    | tar -xz -C /tmp \
 && mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh_${GH_VERSION}_linux_amd64
```

放在 Stage 2 现有 `apk add` 行下面（紧邻 `&& adduser` 之后）。

注意：base image `node:20-alpine` 默认带 `wget`，无需 apk add。

## 不在范围

- 不动 shepherd.js / harness-watcher.js 业务逻辑
- 不动 docker-compose.yml
- 不为 gh 配置 GH_TOKEN（运行时由 secrets 挂载，已存在）

## DoD

- [ARTIFACT] Dockerfile 含下载 gh 的 RUN 行（grep `gh_.*linux_amd64.tar.gz`）
- [BEHAVIOR] 本地 build 后 `docker run --rm cecelia-brain:test command -v gh` 退出码 0
- [BEHAVIOR] `docker run --rm cecelia-brain:test gh --version` 输出含 `gh version`

## 风险与回滚

- 风险低：只加一个独立 RUN 层，不影响现有依赖
- 失败回滚：revert single commit

## 测试策略

- BEHAVIOR 通过 manual:bash 驱动 docker build + docker run（CI 白名单允许 bash）
- 不需要新增单元测试（PRD 明确说不需要）
