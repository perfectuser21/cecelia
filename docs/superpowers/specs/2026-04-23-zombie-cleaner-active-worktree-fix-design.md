# zombie-cleaner P0 fix — 基于 `.dev-mode*` mtime 判活跃 worktree

**Date**: 2026-04-23
**Status**: Approved
**Task**: `6259b170-9409-4bc1-8052-ea930de5cd87`
**Forensic**: Phase B2 PR #2568 期间 interactive worktree `c36991e7-phase-b2-shepherd-active-signal` 被误删（age=33min 踩中 30 min grace 临界）

## 1. 根因

- `zombie-cleaner.js:L104 findTaskIdForWorktree` 只读 `.dev-mode`（无后缀老格式）
- `worktree-manage.sh:L255` 自 v19.0.0 cwd-as-key 改革后写 `.dev-mode.${branch}`（含后缀新格式）
- 文件名不匹配 → `readFileSync` 抛 → `return null` → `activeTasks.has(null) === false` → **所有新格式 /dev worktree 活过 30 min 被 `git worktree remove --force` + `rm -rf` 静默删**
- **铁证**：Brain docker logs 17 条 `Orphan worktree removed ... taskId=unknown` 全部 unknown（命中率 100%）

## 2. 设计

### 2.1 新增 `isWorktreeActive(wtPath)` 函数

扫 wtPath 目录下所有以 `.dev-mode` 开头的文件（`.dev-mode` + `.dev-mode.${branch}` + 未来任何后缀变体），任一 mtime < `ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24h` → active。

```js
const ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isWorktreeActive(wtPath) {
  try {
    const now = Date.now();
    const entries = readdirSync(wtPath).filter(f => f.startsWith('.dev-mode'));
    for (const name of entries) {
      try {
        const mtimeMs = statSync(join(wtPath, name)).mtimeMs;
        if (now - mtimeMs < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS) {
          return true;
        }
      } catch { /* continue on stat error */ }
    }
  } catch { /* readdir failed, treat as inactive */ }
  return false;
}
```

### 2.2 修改清理循环 L189-193

原：
```js
const taskId = findTaskIdForWorktree(wtPath);
if (taskId && activeTasks.has(taskId)) {
  continue;
}
```

改：
```js
// Phase B2-bis: 活跃信号预检（zombie 复用 .dev-mode* mtime 模式）
if (isWorktreeActive(wtPath)) {
  continue;
}
const taskId = findTaskIdForWorktree(wtPath);
if (taskId && activeTasks.has(taskId)) {
  continue; // 老 .dev-mode 格式 + activeTasks 双回退
}
```

### 2.3 导出新常量

```js
export { ..., isWorktreeActive, ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS };
```

### 2.4 为何不动 findTaskIdForWorktree

- 老 `.dev-mode` 格式仍可能存在（Brain docker harness 内部 worktree-manage.sh 版本若未升级）
- 保留 legacy API 避免破坏现有测试 import

## 3. 关键决策

### 3.1 ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24h

- interactive /dev 的 brainstorming/explore 阶段可能数小时不 touch `.dev-mode`
- 真僵尸通常 >24h 无任何 `.dev-mode` 更新（stop-dev.sh 已清理、无人 touch）
- 24h = 一个工作日上限，合理

### 3.2 为何 `.dev-mode*` mtime 可用作信号

证据（subagent 查验）：
- `packages/engine/lib/devloop-check.sh` — CI 失败时 sed 更新 `ci_fix_count +1`
- `cleanup.sh` — sed 更新 `step_4_ship: done` / `cleanup_done: true`
- Stop Hook retry — 写 `retry_count` / `last_block_reason`
- interactive claude 每轮 tool call 触发 Stop Hook → `devloop-check.sh` 读写 → mtime 刷新

### 3.3 与 Phase B2 quarantine-active-signal 的关系

两者思路同构但语义不同：
- Phase B2：按 **taskId** 扫全仓 `.dev-mode.*`（for quarantine 决策）
- 本 PR：按 **wtPath** 扫目录内 `.dev-mode*`（for worktree cleanup 决策）
- 不重复，不共用函数

## 4. 测试

### 4.1 新 cases（在现有 `zombie-cleaner.test.js` 里扩展）

| # | 场景 | 配置 | 断言 |
|---|---|---|---|
| A1 | fresh `.dev-mode.branch` → keep | mock wtPath 目录含 `.dev-mode.cp-xxx` mtime=now-1h | `cleanupOrphanWorktrees` 返回 `removed=0` |
| A2 | 老 `.dev-mode` + activeTasks 命中 → keep | mock `.dev-mode` 含 task_id UUID + activeTasks has 该 id | `removed=0`（findTaskIdForWorktree 路径） |
| A3 | 无 `.dev-mode*` → orphan | mock 目录无 `.dev-mode` 文件 | `removed>=1`（正常清理） |
| A4 | 有 `.dev-mode.branch` 但 stale (>24h) → orphan | mock 文件 mtime=now-25h | `removed>=1` |

### 4.2 isWorktreeActive 独立单元测试

直接 unit test 新函数：fresh match / stale / empty dir / readdir throws。

## 5. 成功标准

1. `isWorktreeActive` 在 cleanupOrphanWorktrees 主循环被调用（grep 确认）
2. 新 4+ cases 全 pass
3. 现有 zombie-cleaner 测试不退化
4. 合并部署后 Brain logs 里 `Orphan worktree ... taskId=unknown` 不再误清活跃 worktree（24h 观察）

## 6. 不做

- `findTaskIdForWorktree` 实现修改（保留 legacy 向后兼容）
- `worktree-manage.sh` 加 `brain_task_id:` 字段（另 PR）
- `ORPHAN_WORKTREE_MIN_AGE_MS`（30 min）调整
- zombie-sweep.js 的第二失效 safety net 修复（另 PR）
- Phase E Observer 分离（搬 zombie-cleaner 到 observers/）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 24h 阈值让真僵尸多占磁盘 | zombie-cleaner tick 每 20 min 跑一次，超 24h 必清 |
| `.dev-mode*` 残留 mtime 新 → 永保护已死 worktree | 死任务的 Stop Hook cleanup 会删 `.dev-mode*` 文件本身；若没删到则是另一 bug |
| 改动 Brain tick 热路径 | 现有 zombie-cleaner 410 行测试保护；新 isWorktreeActive 是纯函数，影响有限 |

## 8. 回滚

还原 zombie-cleaner.js 单文件，`git revert` 即可。
