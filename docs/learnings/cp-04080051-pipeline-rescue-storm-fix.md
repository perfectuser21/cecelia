# Learning: Pipeline Rescue 风暴导致任务成功率 48%

## 事件摘要

24h 任务失败 225 个，其中 191 个（85%）是 `pipeline_rescue` 任务被 watchdog `liveness_dead` 杀死，导致整体成功率仅 48%（231/462）。

## 失败模式分类

| 模式 | 24h数量 | 占比 | 根因 |
|------|---------|------|------|
| pipeline_rescue liveness_dead | 191 | 85% | 陈旧 .dev-mode 文件触发无限 rescue 循环 |
| canceled/cancelled（无错误） | 26 | 11.5% | 父 pipeline 失败/CI Watch 无 PR/Orphan 被取消 |
| SelfDrive liveness_dead | 13 | 5.8% | 诊断任务自身被 watchdog 杀死 |
| API_OVERLOADED / OTHER | 5 | 2.2% | 外部限流 |

### 根本原因

28 个旧分支（cp-04042215 等）的 `.dev-mode.*` 文件残留在主仓库 `/Users/administrator/perfect21/cecelia/`，这些分支的 PR 早已合并或关闭，但文件未被标记 `cleanup_done: true`。

Pipeline Patrol 每 72h 扫描一次这些文件并创建 `pipeline_rescue` 任务。这些 rescue 任务被分配给 agent，但 agent 因无可操作的 worktree 而很快死亡，被 watchdog 标记为 `liveness_dead` → `quarantined`。72h 后循环再次开始，最严重的分支（cp-04062246）累计了 50 次 quarantine。

### 下次预防

- [ ] 每次 Stage 4 (Ship) 完成时，必须确认 `.dev-mode` 文件写入了 `cleanup_done: true`（Stop Hook `cleanup_done` 检测）
- [ ] Pipeline Patrol 现在有 `MAX_RESCUE_QUARANTINE = 3` 封顶：第 3 次 quarantine 后自动写 `cleanup_done`，永久停止该分支的 rescue 循环
- [ ] 如果一个分支的 rescue 任务持续失败，不是重复派任务的理由——应该调查 .dev-mode 文件是否是陈旧的

## 修复内容

1. **`packages/brain/src/pipeline-patrol.js`**:
   - 新增 `MAX_RESCUE_QUARANTINE = 3` 常量
   - 新增 `writeCleanupDone()` 辅助函数
   - `createRescueTask()` 中封顶检查：quarantine 次数 ≥ 3 时写 `cleanup_done` 并跳过创建

2. **批量清理**：18 个 quarantine 次数 ≥ 3 的陈旧 `.dev-mode` 文件被立即标记 `cleanup_done: true`

## 预期效果

Pipeline Rescue 相关失败任务从 ~196/24h 降至接近 0，整体成功率从 48% 提升至 >85%（前提：其他失败模式不显著增加）。
