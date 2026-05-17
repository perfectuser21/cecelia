# zombie-cleaner 误杀活跃 /dev worktree — P0 根因修复

## Goal
修 zombie-cleaner 永久误杀所有活跃 /dev worktree 的 P0 bug。改用 `.dev-mode.*` mtime 判活跃（复用 Phase B2 quarantine-active-signal 同构思路）。

## 背景（forensic 证据链）
- **bug**: `packages/brain/src/zombie-cleaner.js:findTaskIdForWorktree` L104 读 `.dev-mode`（无后缀），但 `packages/engine/skills/dev/scripts/worktree-manage.sh:255` 写 `.dev-mode.${branch}`（v19.0.0 cwd-as-key 后格式）→ 永远 return null → `activeTasks.has(null)=false` → 任何 /dev worktree 活过 30 min 被 `git worktree remove --force` + `rm -rf` 静默删
- **铁证**: docker logs 17 条 `Orphan worktree removed ... taskId=unknown`，全部 taskId=unknown（命中率 100%）
- **命案**: Phase B2 PR #2568 的 interactive worktree (age=33min) 被 zombie-cleaner 清到只剩空 packages/，branch+commits 完好（在 .git/refs）
- **第二个失效 safety net**: `zombie-sweep.js` 按 `payload.branch` 匹配，但 Brain 大部分 task payload 无 branch 字段（本次 task c36991e7 也无）→ 也 dead

## Tasks
1. 读 `packages/brain/src/zombie-cleaner.js` 完整实现 + 相关测试
2. 改 `findTaskIdForWorktree` 为 `isWorktreeActive(wtPath)`：扫 wtPath 下 `.dev-mode` 和 `.dev-mode.*` 文件，任一 mtime < ACTIVE_THRESHOLD_MS（默认 24h=86400_000）→ active=true
3. 清理循环里活跃 worktree 直接 continue（跳过 orphan 判定），不再依赖 activeTasks.has(taskId)
4. 保留 grace period（新建 worktree 30 min 内不判 orphan）
5. 单测覆盖：fresh .dev-mode → keep / stale .dev-mode → orphan / 无 .dev-mode → orphan / 老格式 `.dev-mode` 也识别

## 成功标准
- interactive /dev worktree 活多久都不被误杀（只要 .dev-mode mtime 被 Stop Hook 刷新）
- 真僵尸 worktree (mtime > 24h) 仍被正常清
- 不依赖 task_id 解析（即使 .dev-mode 内容无 task_id UUID 也能正确判活跃）
- 现有 zombie-cleaner 测试不退化

## 不做
- zombie-sweep.js 的 payload.branch 修复（另 PR）
- Brain docker 容器内 git worktree list 失败的独立问题
- 给 .dev-mode.* 加 brain_task_id: 字段（YAGNI，mtime 判活跃足够）
- ORPHAN_WORKTREE_MIN_AGE_MS 常量调整
- Phase E Observer 分离（搬 zombie-cleaner 到 observers/）— 大改

## DoD
- [BEHAVIOR] isWorktreeActive 函数存在且在清理循环 continue 被调用；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/zombie-cleaner.js','utf8'); if(!c.includes('isWorktreeActive')||!c.match(/continue.*isWorktreeActive|isWorktreeActive.*continue/s)) process.exit(1)"
- [BEHAVIOR] 新测试 ≥ 4 cases 全 pass；Test: tests/packages/brain/src/__tests__/zombie-cleaner
- [BEHAVIOR] 现有 zombie-cleaner 测试不退化；Test: manual:npm test --workspace=packages/brain --prefix . -- zombie-cleaner

## 风险
- ACTIVE_THRESHOLD_MS=24h 太宽 → 真 24h+ 僵尸继续占磁盘；太窄 → 跨天 /dev 被误杀
- `.dev-mode.*` 可能被 interactive claude 清理时没删干净，残留文件 mtime 仍新 → 误保护。可接受
- 改动涉及 Brain tick 热路径，需现有测试 0 退化

## 参考
- Forensic: 本 PRD 背景节
- Phase B2 同构: packages/brain/src/quarantine-active-signal.js
- 相关 memory: stop-hook-cwd-as-key.md

