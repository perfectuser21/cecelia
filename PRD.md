# PRD — fix(brain): startup-recovery cleanupStaleWorktrees 加活跃 lock 保护（W7.3 Bug #E）

## 背景 / 问题

`packages/brain/src/startup-recovery.js::cleanupStaleWorktrees` 在 Brain 启动时按
`git worktree list --porcelain` 区分活跃/孤立 worktree，凡不在 list 内的 `WORKTREE_BASE/*` 目录
全部 `rmSync(..., {recursive:true, force:true})`。

5/6 实测事故：4 个正在使用的 `cp-*` worktree（均含活跃 `.dev-lock` 或 `.dev-mode.<branch>`）
被 Brain 启动恢复一锅端清掉，agent 工作被毁。根因：worktree 路径在某些场景下不出现在
`git worktree list`（worktree 元数据漂移、git 版本差异、prune 异常等），仅靠 git list
作为唯一信号会误伤。

## 成功标准

- **SC-001**: worktree 含活跃 `.dev-lock` 文件（mtime 在 24h 内）→ cleanupStaleWorktrees 跳过删除
- **SC-002**: worktree 含活跃 `.dev-mode` 或 `.dev-mode.<branch>` 文件（mtime 在 24h 内）→ 跳过删除
- **SC-003**: 24h 外的旧 lock 不再保护，正常清理路径不被影响
- **SC-004**: 既有 enhanced 单元测试 25 个继续全过（不破回归）

## 范围限定

**在范围内**：
- `packages/brain/src/startup-recovery.js` 新增 `hasActiveDevLock()` + 在 `cleanupStaleWorktrees`
  删除前调用，命中则跳过 + 计数 `skipped_active_lock`
- `packages/brain/src/__tests__/startup-recovery-enhanced.test.js` 加 5 个新 it
- `tests/integration/startup-recovery-active-lock.test.js` 新建（用真实 tmp 目录）
- Brain 版本 bump 1.228.1 → 1.228.3（package.json + .brain-versions + DEFINITION.md）

**不在范围内**：
- `cleanupStaleLockSlots` / `cleanupStaleDevModeFiles` 改造（不涉及）
- `git worktree prune` 行为本身（保持原状）
- `worktree-manage.sh` 调用侧（同样的保护逻辑应该未来在 zombie-cleaner 等处复用，但本 PR 不做）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/startup-recovery.js` 新增 `hasActiveDevLock` export
      Test: `manual:node -e "const {hasActiveDevLock}=await import('./packages/brain/src/startup-recovery.js');if(typeof hasActiveDevLock!=='function')process.exit(1)"`
- [x] [BEHAVIOR] `tests/integration/startup-recovery-active-lock.test.js` — worktree 含活跃 .dev-lock 不被清理
      Test: `tests/integration/startup-recovery-active-lock.test.js`
- [x] [BEHAVIOR] `tests/integration/startup-recovery-active-lock.test.js` — worktree 含活跃 .dev-mode.cp-xyz 不被清理
      Test: `tests/integration/startup-recovery-active-lock.test.js`
- [x] [BEHAVIOR] `tests/integration/startup-recovery-active-lock.test.js` — 24h 外的 lock 不再保护、普通无 lock worktree 正常清理
      Test: `tests/integration/startup-recovery-active-lock.test.js`
- [x] [BEHAVIOR] enhanced 单测 26 个全过（含新增 5 个 + 5 个 hasActiveDevLock 直测）
      Test: `manual:bash -c "cd packages/brain && NODE_OPTIONS='--max-old-space-size=2048' npx vitest run src/__tests__/startup-recovery-enhanced.test.js"`
- [x] [ARTIFACT] Brain 版本 bump 到 1.228.3
      Test: `manual:node -e "const v=require('./packages/brain/package.json').version;if(v!=='1.228.3')process.exit(1)"`

## 受影响文件

- `packages/brain/src/startup-recovery.js`（核心修复）
- `packages/brain/src/__tests__/startup-recovery-enhanced.test.js`（单测加强）
- `tests/integration/startup-recovery-active-lock.test.js`（新建集成测试）
- `packages/brain/package.json`、`packages/brain/package-lock.json`、`.brain-versions`、`DEFINITION.md`（版本同步）
- `docs/learnings/cp-05062125-w7-3-startup-recovery-protect.md`（Learning）

## 部署后验证

合并到 main 并 Brain 重启后：
1. Brain 日志含 `[StartupRecovery:cleanupStaleWorktrees] done ... skipped_active_lock=N` 字段
2. 如果之前出现误清，从今天起活跃 cp-* worktree 不再消失
