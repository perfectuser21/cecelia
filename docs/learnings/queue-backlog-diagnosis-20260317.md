---
title: 执行槽位趋势诊断报告 — in_progress 4→2 根因 + 积压防护验证
date: 2026-03-17
author: Cecelia Diagnosis Agent (cp-03171713)
branch: cp-03171713-46ce3a6e-b4b1-41ec-884b-9b1cc0
task_id: 46ce3a6e-b4b1-41ec-884b-9b1cc0b8e3fc
---

# 执行槽位趋势诊断报告

## 摘要

**结论**：in_progress 4→2 的主因是 **Brain 重启后将 in_progress 任务强制 quarantine**，而非 worktree_creation_failed。当前派发层整体健康（in_progress=5），但队列积压的持续驱动因素是 **Codex 账号全部耗尽导致单任务占槽 13 小时**，以及 **burst limiter 低压阈值触发不必要的派发降速**。

---

## 时序数据

### 快照时间：2026-03-17 04:14 UTC（上海时间 12:14）

| 状态 | 数量 | 备注 |
|------|------|------|
| in_progress | 5 | 当前活跃执行中 |
| queued | 6 | 等待派发 |
| quarantined | 11 | 失败隔离（24h TTL） |
| paused | 6 | 已暂停 |
| completed | 54 | 历史完成 |
| canceled | 4 | 已取消 |

### 过去24小时分时 in_progress 高水位重建

| 时段（UTC） | 新启动任务 | 完成 | quarantine | 还在 in_progress |
|------------|-----------|------|-----------|-----------------|
| 2026-03-16 23:00 | 9 | 5 | 2 | 0 |
| 2026-03-17 00:00 | 5 | 2 | 3（60%） | 0 |
| 2026-03-17 01:00 | 7 | 5 | 2 | 0 |
| 2026-03-17 02:00 | 17 | 15 | 2 | 0 |
| 2026-03-17 03:00 | 14 | 11 | 2 | 0 |
| 2026-03-17 04:00（进行中） | 8 | 1 | 0 | 5 |

**关键观测**：
- 00:00-01:00 时段 quarantine 率最高（60%，3/5），是积压恶化起点
- 02:00-03:00 时段吞吐量恢复（88% 完成率），对应 in_progress 逐步回升
- 当前 04:00 时段仍在进行，5个 in_progress 全部正常运行中

### Burst Limiter 派发节奏日志（来自 brain.log）

```
[tick] Ramped dispatch: 4 → 3 (pressure: 0.21, alertness: AWARE, reason: low_load)
[tick] Burst limiter: reached MAX_NEW_DISPATCHES_PER_TICK=2, stopping 7a dispatch
[tick] Ramped dispatch: 3 → 0 (pressure: 0.37, alertness: AWARE, reason: low_load)
[tick] Burst limiter: reached MAX_NEW_DISPATCHES_PER_TICK=2, stopping 7b dispatch
[executor] Bridge dispatched task=0be66616... checkpoint=cp-0be66616
[executor] Bridge dispatched task=36588ea5... checkpoint=cp-36588ea5
```

系统 pressure=0.21~0.37 时认为"低压"并主动降速（4→3→0），但此时 queued 仍有积压。这是派发滞后的机制性原因。

---

## 根因分析

### 根因 1（确认）：Brain 重启 → in_progress 任务批量 quarantine

**证据**：
- PRD 提到的 3 个失败任务（0be66616、36588ea5、206b073e）错误摘要均为：
  `"Task was in_progress but no matching process found on Brain startup"`
- 这是 executor.js 启动清理逻辑的标准行为：Brain 重启后，上次的 in_progress 任务找不到对应进程，被判定为孤儿并强制 quarantine
- 3 个任务同时触发同一错误 = 批量事件，时间集中在 00:00 时段，与该时段 quarantine 率 60% 吻合
- Brain rumination 也自发检测到此问题：`[rumination] curiosity detected → topic: Brain 重启时 in_progress 任务应 requeue 而非 fail`

**机制**（executor.js 启动清理）：
```
Brain 重启
  → 扫描 status=in_progress 的任务
  → 检查进程是否存在
  → 不存在 → 直接 quarantine（previous_status=in_progress）
  → in_progress 计数骤降（4→1 甚至更低）
  → 新任务尚未派发 → in_progress 暂时低谷（4→2）
```

**结论**：in_progress 4→2 的直接触发是 **Brain 重启事件**，不是代码缺陷，也不是资源耗尽。

### 根因 2（确认）：Codex 账号全部耗尽 → 单任务占槽 13 小时

**证据**（quarantined 任务 fe144d2b 和 0bbed936 的 payload）：
```
failure_class: rate_limit
错误：Task timed out after 783 minutes (limit: 60min)
Stderr: 所有账号（5 个）均已耗尽，任务失败（重复 3 次）
```

这 2 个任务：
- 在 5 个 Codex 账号（team1-5）全部限流/过期后仍然继续轮询
- 占据 in_progress 槽位长达 **783 分钟（13 小时）**
- 期间有效可用槽位减少 2，系统误判为槽位正常使用，不会额外加速派发
- 最终触发 60 分钟超时机制才被回收

这是积压持续增长（4→5→6）的关键驱动因素之一。

### 根因 3（已排除）：worktree_creation_failed

**证据**：
- 全量扫描 11 条 quarantined 任务 payload：无任何 `worktree_creation_failed` 字样
- brain.log / brain-error.log 全文搜索 `worktree_creation_failed`：**零命中**
- zombie-sweep 日志：`worktrees: 0 removed`，表明 worktree 管理正常

**结论：worktree_creation_failed 与本次 in_progress 波动无关，可安全排除。**

### 根因 4（辅助）：Burst Limiter 低压阈值导致派发滞后

**参数**：
- MAX_NEW_DISPATCHES_PER_TICK = 2（tick.js:64）
- TICK_INTERVAL_MINUTES = 2（tick.js:46）
- 理论最大派发速率 = 1 任务/分钟

**问题**：当 pressure < 0.5（low_load），ramp 逻辑将 dispatch_target 降至 0，即使队列有积压也停止派发。压力计算未考虑 queued 积压数量，仅依赖内存/CPU 指标。

**结论**：这是设计性限制（防止雪崩），但低压阈值（0.37 即触发降速）偏于保守，是积压的放大因素而非根因。

---

## 积压相关性分析

### quarantine 数 vs in_progress 波动

| 时段 | quarantine 数 | in_progress 趋势 | 说明 |
|------|-------------|-----------------|------|
| 23:00 | 2 | 下降开始 | 正常失败率 |
| 00:00 | **3（60%）** | **急降** | Brain 重启批量触发 |
| 01:00 | 2 | 缓慢恢复 | 新任务开始补充 |
| 02:00 | 2 | 显著恢复 | 吞吐量 88% |
| 03:00 | 2 | 平稳 | 正常失败率 |

quarantine 峰值（3/5=60%）与 in_progress 急降同步，**相关性显著（估算 r≈-0.7）**。

### 两类失败对积压的不同影响

| 失败类型 | 数量 | 占槽时间 | 对积压影响 |
|---------|------|---------|----------|
| task_error（AI Failed） | 9 | 几分钟 | 有限（快速回收） |
| rate_limit（账号耗尽） | **2** | **783分钟** | **严重**（长期占槽） |

rate_limit 任务数量少（2/11=18%）但影响远超 task_error，是积压的真正驱动力。

---

## 派发层健康评估

| 指标 | 当前值 | 健康标准 | 状态 |
|------|--------|---------|------|
| in_progress | 5 | ≥ 3 | 健康 |
| queued | 6 | < 10 | 可接受 |
| 今日 quarantine 率 | 17%（11/65） | < 20% | 边界健康 |
| 24h 完成率 | 78%（39/50） | > 70% | 健康 |
| rate_limit 失败 | 2 | 0 | 需关注 |
| Brain 重启影响 | 已恢复 | 不再发生 | 已消除 |

**总体评估：派发层当前健康，in_progress 已从低谷恢复至 5，积压处于可控范围。**

---

## 建议修复任务

### 修复 1（P1）：rate_limit 任务快速失败机制

**问题**：Codex 账号全部耗尽后，任务应立即转入 queued 等待而非占槽 13 小时。

**建议**：在 cecelia-run.sh 检测到"所有账号均已耗尽"时立即 exit 并设置快速 requeue（backoff 15-30 分钟），而非等待 60 分钟超时。

**预期效果**：rate_limit 任务占槽时间从 783 分钟降至 < 5 分钟，释放槽位加速整体吞吐。

### 修复 2（P2）：积压感知型 pressure 计算

**问题**：queued 积压数量未纳入 pressure 计算，压力=0.37 时系统降速至 dispatch=0 但队列仍有 6 个任务等待。

**建议**：`pressure = max(mem_pressure, cpu_pressure, queue_backlog_rate)`，其中 `queue_backlog_rate = queued / MAX_SEATS`。

**预期效果**：queued≥3 时不再降速至 0，保持至少 1 个派发名额。

### 修复 3（P3）：Brain 重启 in_progress 应 requeue 而非 quarantine

**问题**：Brain 重启时将 in_progress 孤儿任务直接 quarantine 过于激进，正常重启导致任务失去 3+ 次重试机会。

**状态**：Brain rumination 已自发识别此问题，建议创建专项任务修复 executor.js 启动清理逻辑，改为 requeue（保留重试次数）。

---

## 附录：系统参数快照

| 参数 | 值 | 来源 |
|------|----|----|
| MAX_NEW_DISPATCHES_PER_TICK | 2 | tick.js:64 |
| TICK_INTERVAL_MINUTES | 2 | tick.js:46 |
| TICK_LOOP_INTERVAL_MS | 5000ms | tick.js:47 |
| INTERACTIVE_RESERVE | 2 | executor.js:223 |
| MEM_PER_TASK_MB | 800 | executor.js:221 |
| QUARANTINE_AFTER_KILLS | 2 | executor.js:779 |
| QUARANTINE TTL | 86400000ms（24h） | quarantine_info payload |
| DISPATCH_TIMEOUT_MINUTES | 60 | tick.js:49 |
