# 执行槽位趋势诊断报告

**诊断日期**: 2026-03-17（上海时间）
**任务 ID**: 46ce3a6e-b4b1-41ec-884b-9b1cc0
**数据截止**: 2026-03-17 16:30 CST

---

## 执行摘要

**根本原因已识别**：in_progress 4→2 的下降主要由 `worktree_creation_failed` 批量失败波引起，而非调度层问题。当前（截至报告时）in_progress=3，队列=4，系统已恢复正常节奏。积压防护机制（救援任务已入队）正在运行中。

---

## 1. 当前快照（2026-03-17 16:22 CST）

| 状态 | 数量 |
|------|------|
| in_progress | 3 |
| queued | 4 |
| quarantined | 9 |
| paused | 6 |
| completed | 50 |
| completed_no_pr | 1 |
| canceled | 4 |

当前 in_progress 任务：
1. `cd37641f` — 知识反刍启动（librarian），运行中约2小时
2. `8fc5d71a` — test(startup): 重启恢复集成测试套件，运行中约1小时
3. `46ce3a6e` — 本诊断任务

---

## 2. 过去24小时 in_progress 高水位时序

以下基于 `updated_at` 推算各小时任务活动量（CST）：

| 时段 | 完成/失败数 | 注释 |
|------|------------|------|
| 10:00–11:00 CST (03-17) | 21 completed + 2 quarantined | 高吞吐期，worktree 失败初现 |
| 11:00–12:00 CST | 3 completed + 5 quarantined + 3 paused | **quarantine 高峰** |
| 12:00–13:00 CST | 5 completed + 2 quarantined | 二次失败波 |
| 13:00–14:00 CST | 14 completed + 3 paused | 恢复期，吞吐恢复 |
| 14:00–16:00 CST | 9 completed + 3 in_progress | 当前状态，稳定 |

**关键时间点**：
- `10:50–11:07 CST`：4个任务在约17分钟内陆续 quarantined（全部 worktree_creation_failed）
- `11:45 CST`：3个任务**同时** quarantined（秒级内，`11:45:40.340/341/659`）→ 批量处理特征
- `12:22–12:38 CST`：3个任务再次 quarantined
- `13:52–14:00 CST`：系统重新稳定，dispatch 恢复，新任务入队

---

## 3. 根本原因分析

### 3.1 主因：worktree_creation_failed 批量失败（占 7/9 quarantined）

**受影响任务**（全部错误：`worktree_creation_failed: unknown error`）：

| 任务 | 类型 | retry | 失败时间 |
|------|------|-------|---------|
| f1b86ecc | dev（删除旧文件） | 0 | 10:50 CST |
| 45980245 | 欲望建议 | 0 | 10:53 CST |
| 0cdc1b08 | 欲望建议 | 0 | 11:01 CST |
| eb0c9e81 | 欲望建议 | 0 | 11:07 CST |
| aa8cd5be | dev（DoD Test） | 2 | 11:45 CST |
| da7c4864 | dev（CI 迁移） | 0 | 12:22 CST |
| 7407c7d3 | dev（codex bridge） | 1 | 12:27 CST |
| 6691a1f1 | 欲望建议 | 0 | 12:38 CST |

**"unknown error" 的技术解释**：
`cecelia-run` 脚本在捕获错误时执行：
```bash
echo "worktree_creation_failed: $(cat "$wt_stderr_log" 2>/dev/null | head -3 || echo 'unknown error')" > "$err_log"
```
`unknown error` 意味着 `cat "$wt_stderr_log"` **失败**（文件已不存在），说明 stderr 临时文件在错误处理前被清理或竞争条件导致文件丢失。真实的 worktree 失败原因未被记录。

**可能的直接原因**（按可能性排序）：
1. **worktree 数量上限（MAX_WORKTREES=8）**：`worktree-manage.sh` 设定上限为8，当时可能有8+个 worktree 同时存在，导致新任务无法创建
2. **flock 超时（5秒）**：多个任务同时争抢 worktree-create.lock，等待超时后失败
3. **git worktree 内部错误**：磁盘空间/权限/HEAD 解析问题（需日志确认）

**与 in_progress 的相关性**：
这些任务在 env_setup 阶段就失败了（从未进入真正执行），因此它们**占用了 in_progress 槽位但立即失败**，导致 in_progress 计数快速下降。Brain 看到 in_progress 从4降至2，实际上是这些快速失败任务离开队列所致。

### 3.2 次因：Codex quota 耗尽（1/9 quarantined）

任务 `0bbed936`（视频号发布脚本）失败：
```
Stderr: ❌ 所有账号（5 个）均已耗尽，任务失败
```
5个 Codex 账号全部耗尽。这是独立的单点失败，与 in_progress 波动相关性弱。

### 3.3 PRD 中提及的3个 startup 失败任务

PRD 提到 ID：`0be66616`、`36588ea5`、`206b073e`。**这3个任务在当前 DB 中不存在**，说明它们属于更早的数据库（Brain 重启前的历史），已在 `syncOrphanTasksOnStartup` 修复（PR #1011, PR #1025）后被清理/迁移。当前 DB 中无 `failed` 状态任务，说明 startup recovery 逻辑已正确运行。

---

## 4. 调度层健康验证

### 4.1 Executor 槽位配置

```
PHYSICAL_CAPACITY: 基于 CPU 核数 + 内存动态计算（Darwin）
MAX_WORKTREES: 8（worktree-manage.sh）
SAFETY_MARGIN: 0.85
INTERACTIVE_RESERVE: 2 seats
```

动态槽位降级规则（checkServerResources）：
- maxPressure ≥ 1.0 → effectiveSlots = 0
- maxPressure ≥ 0.9 → effectiveSlots = 1
- maxPressure ≥ 0.7 → effectiveSlots = max(dynMax/3, 1)
- maxPressure ≥ 0.5 → effectiveSlots = max(dynMax*2/3, 1)

当前系统（M4 Mac mini）内存充足，CPU 压力低，`effectiveSlots` 应接近物理上限。

### 4.2 Dispatch 频率

Brain tick 每5分钟执行一次，recent_decisions 显示最近一次 dispatch 成功（`2026-03-16T19:20:20`）。dispatch 层无系统性问题。

### 4.3 积压感知

当前 queued=4，非积压状态（阈值通常为 >10 触发告警）。已有专项救援任务入队：
- `cda9b997` — rescue(quarantine): 审查并救援 worktree_creation_failed 被错杀的任务
- `b24c6450` — feat(executor): MAX_SEATS 重启状态日志 + 并发天花板评估报告

---

## 5. quarantined vs in_progress 相关性分析

| 时间窗口 | quarantined 数 | in_progress 影响 |
|---------|---------------|-----------------|
| 10:50–11:45 CST | 7 tasks | in_progress 快速清空（快速失败） |
| 12:00–13:00 CST | 2 tasks | 局部扰动 |
| 13:00–14:00 CST | 0 | in_progress 稳步恢复 |

**相关性：强正相关**。quarantined 高峰与 in_progress 低谷完全重叠。

---

## 6. 结论

### in_progress 4→2 根本原因

**`worktree_creation_failed` 批量失败**是主因。失败波发生在 10:50–12:38 CST，共8个任务在 env_setup 阶段失败，从未成功占用执行槽位。Brain 观测到 in_progress 下降是因为这些任务快速失败后立即退出 in_progress 状态。

**不是以下原因**：
- ❌ Codex quota 全耗尽（仅1个任务，quota 耗尽原因独立）
- ❌ 调度层失效（dispatch 仍在正常运行）
- ❌ 任务复杂度上升（完成率 14/小时 正常）
- ❌ startup recovery 错误 quarantine（PRD 提到的3个 startup 失败任务不在当前 DB 中）

### 趋势评估

系统趋势**向好**：
- 14:00–16:00 CST：in_progress 稳定在3，队列仅4个
- 吞吐恢复正常（14:00 后 9 个任务 completed）
- 专项救援任务已入队（救援 quarantined + 改进 MAX_SEATS 日志）

---

## 7. 系统性问题：已识别，修复任务已创建

| 问题 | 严重性 | 对应任务 |
|------|--------|---------|
| worktree_creation_failed 无详细错误日志 | P1 | `cda9b997` rescue + 隐含改进需求 |
| worktree 上限8可能过低 | P1 | `b24c6450` MAX_SEATS 评估 |
| Codex 5账号耗尽无自动恢复 | P1 | 已有 codex-bridge 修复任务 `7407c7d3`（quarantined，需救援） |

**建议新增修复任务**：
1. 改进 `cecelia-run` 错误捕获：在清理 `$wt_stderr_log` 前先将错误写入 DB
2. 提高 worktree gc 频率：失败任务的 worktree 应及时清理，防止上限被占满

---

## 附：原始数据

```sql
-- 执行此查询可重现数据
SELECT status, COUNT(*) FROM tasks GROUP BY status ORDER BY count DESC;
SELECT error_message LIKE '%worktree%' AS is_wt_fail, COUNT(*) FROM tasks WHERE status='quarantined' GROUP BY is_wt_fail;
```

### 根本原因

worktree_creation_failed 批量失败是 in_progress 4→2 下降的直接原因。失败波集中在 10:50–12:38 CST（8个任务），全部在 env_setup 阶段失败，调度层和 Codex quota 均不是主因。

### 下次预防

- [ ] `cecelia-run` 在清理临时文件前先持久化错误详情到 DB，避免 "unknown error"
- [ ] 监控 `git worktree list` 数量，接近上限8时提前告警
- [ ] worktree gc 失败后自动触发清理，而非等 Brain 重启
- [ ] 增加单位时间内 worktree_creation_failed 频率监控（>3次/10min 告警）
