# DoD: W7.3 Bug #E startup-recovery cleanupStaleWorktrees 加活跃 lock 保护

## 概述
5/6 startup-recovery 误清 4 个含活跃 dev-lock 的 cp-* worktree。修：cleanupStaleWorktrees
删除前先检查 worktree 内是否含 24h 内修改的 .dev-lock 或 .dev-mode.<branch>，命中则跳过。

## 验收

- [x] [ARTIFACT] startup-recovery.js 导出 hasActiveDevLock 函数
  Test: manual:node -e "const m=await import('./packages/brain/src/startup-recovery.js');if(typeof m.hasActiveDevLock!=='function')process.exit(1)"

- [x] [BEHAVIOR] worktree 含活跃 .dev-lock → 不被清理（skipped_active_lock 计数 ≥1，目录还在）
  Test: tests/integration/startup-recovery-active-lock.test.js

- [x] [BEHAVIOR] worktree 含活跃 .dev-mode.cp-xyz → 不被清理
  Test: tests/integration/startup-recovery-active-lock.test.js

- [x] [BEHAVIOR] .dev-lock mtime 超过 24h → 视为残留，正常清理（保护 false negative 不发生）
  Test: tests/integration/startup-recovery-active-lock.test.js

- [x] [BEHAVIOR] worktree 无 lock → 正常清理（保护逻辑不破坏既有路径）
  Test: tests/integration/startup-recovery-active-lock.test.js

- [x] [BEHAVIOR] enhanced 单测 26 个全过（含 5 个新加 + 5 个 hasActiveDevLock 直测）
  Test: manual:bash -c "cd packages/brain && NODE_OPTIONS='--max-old-space-size=2048' npx vitest run src/__tests__/startup-recovery-enhanced.test.js"

- [x] [ARTIFACT] Brain 版本 bump 到 1.228.3（package.json + .brain-versions + DEFINITION.md）
  Test: manual:node -e "const v=require('./packages/brain/package.json').version;if(v!=='1.228.3')process.exit(1)"
