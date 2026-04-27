# Learning: Tier 1 加固 — worktree race condition + 4 lint 长牙（2026-04-27）

- 影响：开发流程 foundation 的可信度
- 触发：4 agent 并行审计找出的 5 处致命缝隙 Tier 1 项

---

### 根本原因

#### 缝隙 1：worktree race condition

7 个清理脚本（zombie-cleaner / zombie-sweep / startup-recovery / cleanup-merged-worktrees / cecelia-run cleanup trap / janitor / emergency-cleanup）**全局无 lock**。当 Brain tick 跑到 zombie-cleanup 同时 cecelia-run trap 也在 worktree remove 同一目录时，`.git/worktrees` 元数据被并发写撕坏 → cwd 不识别 git → 进程失能。

最近一周 6 个并行 agent（d2-builder / cleanup-B / cicd-D / smoke-fix-B/C / b-fix-2 / rum-rescue）的 worktree 神秘消失全是这条根因。我之前每次都"手动重建恢复"绕开，**根因从未查清** —— 因为没有人定下来一定要找根因。

#### 缝隙 2：4 lint job 全可绕

- `lint-test-pairing`：建空 test 文件（无 it/test 调用）→ 文件存在即过
- `lint-feature-has-smoke`：建 `#!/bin/bash; exit 0` → 文件存在即过
- `lint-tdd-commit-order`：commit 含 `it.skip(...)` → 顺序对就过
- 这些 lint **机器化纪律**初衷是"AI 没法绕"，但只检查文件名和元数据，不验内容 → 等于装样子

#### 缝隙 3：zombie-cleaner 不兼容 v19.0.0 .dev-mode 新格式

`findTaskIdForWorktree` 只读 `.dev-mode`（无后缀），v19.0.0 cwd-as-key 改 `.dev-mode.<branch>` per-branch 后读不到 → taskId=null → 即使任务在 in_progress 也走 orphan 分支被删。这是上面 worktree 神秘消失的次要原因（`isWorktreeActive` 已修但 `findTaskIdForWorktree` 漏修）。

---

### 修复

**cleanup-lock**（cross-process 互斥）
- `packages/brain/src/utils/cleanup-lock.js`：mkdir(2) 原子语义，跨 macOS/Linux 不依赖 flock(1)（macOS 没有）
- `packages/brain/scripts/cleanup-lock.sh`：bash 同协议 helper
- 5 个清理脚本统一持锁
- 8 个单测：acquire/release / 已持锁立即失败 / stale 强夺 / withLock 异常路径

**4 lint 加内容校验**
- `lint-test-pairing`：test 必须 ≥1 个非 skip 的 it/test/expect
- `lint-feature-has-smoke`：smoke.sh 必须 ≥5 实代码行 + ≥1 个 curl/psql/docker/node 调用
- `lint-tdd-commit-order`：test commit 必须含真 it/test 且非全 skip

**zombie-cleaner 兼容**
- `findTaskIdForWorktree` 改成扫所有 `.dev-mode*` 文件

**3 zombie-* test mock cleanup-lock pass-through**
- fs 被 mock 时真锁失败 → 单测里 mock `withLock` 直接 invoke fn 让原路径走通

---

### 下次预防

- [ ] 任何**多进程同时操作的共享资源**（git worktrees / lock dirs / state files）必须有全局 lock — 默认就是 cleanup-lock，例外要在 PR 描述说明
- [ ] **lint 必须验内容不能只验存在** —— "文件名对就过"等于装样子
- [ ] **worktree 神秘消失这种现象出现时第一时间根因调查**，不要"手动重建"绕开（之前 6 次重建累积浪费 ~2h）
- [ ] 任何做"per-branch 文件格式"重命名（如 v19.0.0 `.dev-mode` → `.dev-mode.<branch>`）的 PR，必须 grep 全仓库找所有读老格式的 caller 同步改 —— 教训跟 D1.6 hotfix 一样（漏 routes/tasks.js）
