# Learning: Pipeline Patrol 持续误报 — 遗留 .dev-mode 文件根因

**Branch**: cp-03220623-dc232f04-f674-4258-aa94-418e9c（rescue 任务）
**目标分支**: cp-03222012-redesign-task-type-page

### 根本原因

Patrol 对 `cp-03222012-redesign-task-type-page` 触发了三次 rescue（PR #1380/#1382 已合并），
根因是 **主仓库根目录遗留了 `.dev-mode.cp-03222012-redesign-task-type-page` 文件**，
文件内 `step_2_code: pending`，`cleanup_done` 字段缺失。

Patrol 扫描逻辑（`pipeline-patrol.js` 第342行）：
```js
if (parsed.cleanup_done) continue;  // cleanup_done 缺失 → 不跳过 → 持续触发
```

脱机清理（Stage 4）未能运行的原因：原始任务被 Brain cancel 时 worktree 已删，
但 `.dev-mode.*` 文件留在主仓库根（非 worktree 目录），不随 worktree 删除。

### 解决方案

追加 `cleanup_done: true` 到遗留文件，Patrol 下次扫描自动跳过。

```bash
echo "cleanup_done: true" >> .dev-mode.cp-03222012-redesign-task-type-page
```

### 下次预防

- [ ] Stage 4 cleanup（或 Brain cancel 任务时）必须删除/标记所有 `.dev-mode.*` 文件，
      包括主仓库根目录（不仅仅是 worktree 目录内）
- [ ] Patrol 的冷却时间（2小时）与 rescue 任务完成时间不匹配时，应检查 `.dev-mode` 文件是否遗留
- [ ] 当同一 branch 触发第二次 rescue 时，诊断步骤应优先 `find . -name ".dev-mode.*"` 检查文件状态
