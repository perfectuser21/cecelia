# Brain 容器加 git / openssh / ca-certificates 依赖

**日期**: 2026-04-22
**分支**: cp-0422153300-brain-container-git-dep
**Task**: b4e92e19-1e11-4044-b5a1-bba9f5f79d0c

## Bug

Brain 容器内 `harness-initiative-runner` 调 `spawn git clone` 失败：`spawn git ENOENT`。

实测 `docker exec cecelia-node-brain which git` 无输出。`packages/brain/Dockerfile` 只装了：
```
apk add --no-cache curl bash procps tini docker-cli
```

Alpine base image 默认不含 git / ssh。Brain 运行时跑 harness Phase A 调 `ensureHarnessWorktree` 会调 `git clone` / `git worktree` 准备 Initiative 的 worktree，全挂。

## 影响范围

- Phase A `ensureHarnessWorktree` → `git clone` 直接 ENOENT
- Phase C `runFinalE2E` 也可能 git 操作
- Harness v2 pipeline 在 Brain 容器里**完全跑不了**
- 今天早 Initiative 2303a935 重启后 prep failed 就是这个

## 修复

`packages/brain/Dockerfile` 的 apk add 行追加：
```
apk add --no-cache curl bash procps tini docker-cli git openssh-client ca-certificates
```

三样都要：
- `git`：clone/worktree 等
- `openssh-client`：git 走 ssh:// 协议时需要（但我们 HTTPS + GITHUB_TOKEN，短期可不加，加上保险）
- `ca-certificates`：HTTPS 连 GitHub 验证证书

## 成功标准

- `docker exec cecelia-node-brain which git` → `/usr/bin/git`
- Initiative 2303a935 重跑，prep 阶段不再 ENOENT（至少能进 Planner）
- 镜像 size 增加 < 30 MB（git 约 17 MB）

## 范围

- 只改 `packages/brain/Dockerfile` 一行
- 重建 cecelia-brain:latest + 重启容器生效

不改 brain src / compose / 脚本。
