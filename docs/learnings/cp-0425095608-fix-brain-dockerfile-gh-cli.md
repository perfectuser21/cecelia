# Brain Dockerfile 装 gh CLI

## 根本原因

Brain 容器镜像 Stage 2 只装了 `curl bash procps tini docker-cli git openssh-client ca-certificates`，没装 gh CLI。但 `packages/brain/src/shepherd.js` 调 `gh pr view` / `gh pr merge` 轮询合并 open PR、`packages/brain/src/harness-watcher.js` 调 `gh run list` 查 CI 状态，运行时全部 'command not found'。Harness v6 两条关键链路（auto-merge + CI 监控）失联。

镜像构建脚本 `scripts/brain-build.sh` 默认 skip tests，CI 只跑 lint，本地不 `docker run --rm gh --version` 自检 → 缺工具问题永远进不了门禁。

## 下次预防

- [ ] 新增 Brain 内部对外部 CLI 工具的依赖时，**同 PR 改 Dockerfile** 装该工具
- [ ] Brain Dockerfile 改动 push 前本地 `docker build + docker run --rm <image> command -v <tool>` 自检
- [ ] PR 模板补一项：本 PR 引入新 shell 命令？容器是否已装？

## 修复

`packages/brain/Dockerfile` Stage 2 在现有 `apk add` 行后追加一段独立 RUN：下载 gh v2.45.0 linux_amd64 tar，解压抽出 `gh` 二进制到 `/usr/local/bin/gh`，删除临时目录。

选择 release tarball 而非 `apk add github-cli`：alpine community repo 稳定性低、版本滞后；release tar 版本可控、官方签发。

`node:20-alpine` base image 默认带 wget，无需额外 apk add。

本地验证（已通过）：
- `grep -E 'gh_.*linux_amd64\.tar\.gz' packages/brain/Dockerfile` → 命中
- `docker run --rm cecelia-brain:gh-test command -v gh` → `/usr/local/bin/gh` exit 0
- `docker run --rm cecelia-brain:gh-test gh --version` → `gh version 2.45.0` exit 0
