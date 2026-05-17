# Brain Dockerfile gh CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Brain 容器镜像 (`packages/brain/Dockerfile`) Stage 2 装 gh CLI，让 shepherd / harness-watcher 链路恢复。

**Architecture:** 在 Stage 2 现有 `apk add` 行下面追加一段 RUN，下载 gh release tarball（v2.45.0 linux_amd64），解压抽出 `gh` 二进制到 `/usr/local/bin/gh`，删除临时目录。`node:20-alpine` base 默认带 wget，无需额外依赖。

**Tech Stack:** Docker, Alpine Linux, GitHub CLI release binary

---

### Task 1: Dockerfile 加 gh CLI 安装行

**Files:**
- Modify: `packages/brain/Dockerfile`（Stage 2 第 19-20 行附近）

- [ ] **Step 1: 编辑 Dockerfile，在 `apk add` 行下方追加 gh 安装 RUN**

定位行（当前第 19-20 行）：

```dockerfile
RUN apk add --no-cache curl bash procps tini docker-cli git openssh-client ca-certificates \
 && adduser -D -u 1001 cecelia
```

在它**后面**插入新 RUN：

```dockerfile
RUN apk add --no-cache curl bash procps tini docker-cli git openssh-client ca-certificates \
 && adduser -D -u 1001 cecelia

# Install gh CLI for shepherd.js (gh pr view/merge) and harness-watcher.js (gh run list)
# Use release tarball instead of apk's github-cli (community repo, less stable)
RUN GH_VERSION=2.45.0 \
 && wget -qO- https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz \
    | tar -xz -C /tmp \
 && mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh_${GH_VERSION}_linux_amd64
```

- [ ] **Step 2: grep 验证 ARTIFACT**

Run: `grep -E 'gh_.*linux_amd64\.tar\.gz' packages/brain/Dockerfile`
Expected: 输出含 `wget -qO- https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz`

- [ ] **Step 3: 本地 build Brain 镜像验证 BEHAVIOR**

Run（在仓库根，**主仓 cwd**，不是 worktree）:
```bash
docker build -t cecelia-brain:gh-test -f packages/brain/Dockerfile /Users/administrator/worktrees/cecelia/fix-brain-dockerfile-gh-cli
```
Expected: build 成功，最后输出 `Successfully tagged cecelia-brain:gh-test`

- [ ] **Step 4: 验证 gh 已装**

Run: `docker run --rm cecelia-brain:gh-test command -v gh`
Expected: 输出 `/usr/local/bin/gh`，退出码 0

Run: `docker run --rm cecelia-brain:gh-test gh --version`
Expected: 输出含 `gh version 2.45.0`

- [ ] **Step 5: 写 Learning（push 前必须有）**

Create: `docs/learnings/cp-0425095608-fix-brain-dockerfile-gh-cli.md`

```markdown
# Brain Dockerfile 装 gh CLI

## 根本原因

Brain 容器镜像 Stage 2 只装了 `curl bash procps tini docker-cli git openssh-client ca-certificates`，没装 gh CLI。但 `shepherd.js` 调 `gh pr view/merge`、`harness-watcher.js` 调 `gh run list`，运行时都 'command not found'。两条 Harness v6 关键链路（auto-merge / CI 监控）全废。

## 下次预防

- [ ] 新增 Brain 内部对外部 CLI 工具的依赖时，必须同时改 Dockerfile 装该工具
- [ ] Brain Dockerfile 改动 push 前本地 `docker build + docker run --rm command -v <tool>` 自检
- [ ] PR 模板补一项：本 PR 引入新 shell 命令？容器是否已装？

## 修复

`packages/brain/Dockerfile` Stage 2 加一段 RUN：下载 gh v2.45.0 linux_amd64 tar，解压抽出二进制到 `/usr/local/bin/gh`。选 release tar 不选 `apk add github-cli`（community repo 稳定性低）。
```

- [ ] **Step 6: Commit**

```bash
git add packages/brain/Dockerfile docs/learnings/cp-0425095608-fix-brain-dockerfile-gh-cli.md
git commit -m "fix(brain): Dockerfile 装 gh CLI 修 shepherd/watcher 失联"
```

---

## Self-Review

- **Spec coverage:** spec 三条 DoD 全覆盖（ARTIFACT grep、BEHAVIOR command -v、BEHAVIOR gh --version）
- **Placeholder scan:** 无 TBD / TODO，所有命令含完整 expected output
- **Type consistency:** 单文件单行修改，无类型/签名问题
- **Learning:** push 前已写入

## DoD（与 PRD 对齐）

- `[ARTIFACT]` Dockerfile 含 `gh_.*linux_amd64.tar.gz`（Step 2 grep）
- `[BEHAVIOR]` `command -v gh` 退出码 0（Step 4）
- `[BEHAVIOR]` `gh --version` 输出 `gh version`（Step 4）
