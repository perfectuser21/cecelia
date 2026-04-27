# PRD: Tier 1 加固 — worktree race + 4 lint 长牙 + zombie-cleaner 兼容

## 背景

承接 Tier 0（PR #2664 已合）。4 agent 审计找出的另外 3 处致命缝隙：

1. **worktree race condition** — 7 个清理脚本（zombie-cleaner / zombie-sweep / startup-recovery / cleanup-merged-worktrees / cecelia-run cleanup trap / janitor / emergency-cleanup）**全局无 lock**，并发删 → `.git/worktrees` 元数据撕坏 → cwd 不识别 git。最近一周 6 个并行 agent worktree 神秘消失全是这条根因。
2. **4 lint job 牙齿 2-3/5 全可绕** — 建空 test 文件 / 空 smoke.sh / commit 顺序游戏 / `it.skip` 包围。
3. **zombie-cleaner 不兼容 v19.0.0 .dev-mode 新格式** — `findTaskIdForWorktree` 只读 `.dev-mode`（无后缀），v19 改 `.dev-mode.<branch>` per-branch 后读不到 → taskId=null → 任务在 in_progress 但被当 orphan 删。

## 目标

让 worktree 神秘消失彻底没了，4 lint 真有牙不能绕，zombie-cleaner 不再误删活跃 worktree。

## 范围

### 一、cleanup-lock 跨进程互斥锁
- 新增 `packages/brain/src/utils/cleanup-lock.js`（mkdir 原子语义，跨 macOS/Linux 不依赖 flock(1)）
- 新增 `packages/brain/scripts/cleanup-lock.sh`（bash 同协议 helper）
- 8 个单测：acquire/release / 已持锁立即失败 / stale 强夺 / withLock 异常路径

### 二、5 个清理脚本统一持锁
- `zombie-cleaner.js`：`withLock` 包 `git worktree remove`
- `zombie-sweep.js`：同上
- `startup-recovery.js`：`withLock` 包整个 `cleanupStaleWorktrees`
- `cleanup-merged-worktrees.sh`：subshell + acquire/release
- `cecelia-run.sh` cleanup trap：source helper + acquire/release

### 三、4 lint 加内容校验防绕过
- `lint-test-pairing`：test 文件必须 ≥1 个非 skip 的 it/test/expect
- `lint-feature-has-smoke`：smoke.sh 必须 ≥5 实代码行 + ≥1 个 curl/psql/docker/node 调用
- `lint-tdd-commit-order`：test commit 必须含真 it/test 且非全 skip
- `lint-base-fresh`：保持不变（MAX_BEHIND=5 合理）

### 四、zombie-cleaner findTaskIdForWorktree 兼容
- 改成扫所有 `.dev-mode*` 文件，覆盖老 `.dev-mode` 和新 `.dev-mode.<branch>` 两种格式

### 五、3 个 zombie-* test mock cleanup-lock pass-through
- fs 被 vi.mock 时真锁会失败，单测 mock `withLock` 直接 invoke fn 让原路径走通

## 验收

- worktree 不再神秘消失（观察 1 周内有无 cwd 不识别 git 报告）
- 试图 push 含空 test 文件 / `#!/bin/bash; exit 0` smoke / `it.skip` 重排 commit 的 PR → CI 立刻拒
- zombie-cleaner 不再误删 in_progress 任务的 worktree
