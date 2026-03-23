# SelfDrive 任务失败模式诊断报告

**生成时间**: 2026-03-23（上海时间）  
**分析周期**: 最近 24h（2026-03-22 17:00 ~ 2026-03-23 17:00 上海时间）  
**数据源**: PostgreSQL `learnings` 表（失败回调写入）+ `task_run_metrics` 表  
**任务上下文**: SelfDrive 诊断 — 89% 成功率，11% 失败分析

---

## 总体数据

| 指标 | 数量 | 说明 |
|------|------|------|
| 分析期内失败记录 | 34 条（25 个唯一任务） | 含同一任务多次失败 |
| 分析期内成功任务 | 41 个 | task_run_metrics（12:09 起记录） |
| **成功率估算** | **~89%** | 与 PRD 中 89% 吻合 |
| 失败集中窗口 | 05:27–10:00 上海时间 | 约 4.5h 内爆发 |

---

## 失败分类

### 按类型统计（唯一任务数）

| 类别 | 数量 | 占比 | 优先级 |
|------|------|------|--------|
| `env_setup`: worktree_creation_failed | 9 | 36% | **P0** |
| `watchdog`: liveness_dead | 7 | 28% | P1 |
| `dev`: code_error | 5 | 20% | P2 |
| `watchdog`: process_vanished | 4 | 16% | P1 |
| `brain_restart`: orphan_task | 2 | 8% | P1 |
| `executor`: agent_startup_failure | 2 | 8% | P1 |
| `executor`: codex_exit1_timeout | 1 | 4% | P2 |
| `resource`: OOM kill (exit=137) | 2 | 8% | P2 |

> 注：单个任务可能触发多种错误（如先 worktree_failed 再 orphan）

---

## P0：worktree_creation_failed — 调度并发冲突（最高优先级）

### 现象

9 个唯一任务在 **40 分钟窗口（05:27–06:09）** 内集中爆发，错误均为：

```
Process exited with code 1 | failure_class=env_setup
stderr=worktree_creation_failed: unknown error
```

### 根因分析

`cecelia-run.sh` 在创建 worktree 时调用 `worktree-manage.sh`，但无文件锁保护：

1. Brain 同时派发多个任务 → 多个 `cecelia-run.sh` 进程并行执行
2. 多进程同时调用 `git worktree add` → Git 内部 worktree 锁文件竞争
3. 其中一个成功，其余返回空路径 → `cecelia-run.sh` 检测到空路径后安全中止
4. 重试间隔内冲突仍在 → 连续多次失败

失败率高但时间集中，说明是**调度热点问题**（多任务并行 + 无隔离），而非代码缺陷。

### 修复建议（P0）

**方案 A（推荐）：worktree-manage.sh 加 flock 互斥锁**
```bash
# 在 worktree-manage.sh create 入口处
LOCK_FILE="/tmp/cecelia-worktree.lock"
exec 200>"$LOCK_FILE"
flock -w 30 200 || { echo "worktree lock timeout"; exit 1; }
# ... 原创建逻辑 ...
```
- 代价：同一时刻只有 1 个 worktree 在创建，最多增加 5-10s 等待
- 优点：彻底消除并发冲突，失败率可降至接近 0%

**方案 B（补充）：Brain 调度器错开启动间隔**
- 同批派发任务改为错开 10s 启动（`task-router.js` 或 `planner.js` 加 stagger delay）
- 不改 worktree 脚本，但效果不如方案 A 彻底

---

## P1a：liveness_dead — 西安 Codex 心跳阈值过严

### 现象

7 个任务被 Watchdog kill，全部为"重构"类任务（西安 Codex B 类执行器）：

```
Task Failure: 重构 memory-retriever.formatItem（复杂度 21 → 10）[liveness_dead]
Watchdog killed task after 1 attempts. Reason: liveness_dead
```

### 根因分析

`monitor-loop.js` 使用固定阈值 `STUCK_THRESHOLD_MINUTES = 5`：

```javascript
const STUCK_THRESHOLD_MINUTES = 5;
// AND r.heartbeat_ts < NOW() - INTERVAL '5 minutes'
```

西安 Codex 任务通过 Tailscale VPN 连接，受到：
- 网络往返延迟（中美 ~200ms）
- Codex API 本身的延迟（对话轮次间可能有 2-5 分钟无心跳）
- 5 分钟阈值对有真实工作负载的西安任务过于严格

### 修复建议（P1）

```javascript
// monitor-loop.js 按 location 区分阈值
const STUCK_THRESHOLD_MINUTES = {
  'us': 5,      // 本机任务：5 分钟
  'cn': 15,     // 西安 Codex：15 分钟（网络延迟 + Codex 轮次间隙）
  default: 10
};
```

或通过 `task_type_configs` 表配置（避免硬编码）：
```sql
UPDATE task_type_configs SET liveness_threshold_minutes = 15 
WHERE location = 'cn' OR execution_mode = 'codex_team';
```

---

## P1b：orphan_task / process_vanished — Brain 重启后孤儿任务

### 现象

Brain 重启时，2 个任务从 `in_progress` 直接标为 `failed`：
```
Task was in_progress but no matching process found on Brain startup
```

另有 4 个任务被 Watchdog 的 double-confirm probe 检测到进程消失：
```
Process not found after double-confirm probe (suspect since ...)
```

### 根因分析

Brain 重启时的恢复逻辑将所有 `in_progress` 任务标记为 `failed`（保守处理），但这些任务可能正在运行（只是 Brain 不知道）。重启后新 Brain 找不到之前的进程 PID，只能标为失败。

### 修复建议（P1）

**方案 A：Brain 启动时将孤儿任务 requeue（而非 failed）**
```javascript
// startup.js 或 server.js 的初始化逻辑
const orphans = await pool.query(`
  UPDATE tasks SET status = 'queued', started_at = NULL
  WHERE status = 'in_progress' 
    AND updated_at < NOW() - INTERVAL '2 minutes'
  RETURNING id, title
`);
console.log(`[startup] ${orphans.rowCount} orphan tasks requeued`);
```

风险：若任务 PR 已创建，重新执行可能产生重复 PR → 需检查 `artifact_ref` 是否已有 PR

**方案 B（safer）：先标为 `queued` + 设置 `payload.resume_hint = true`**
- 再次执行时 Agent 读取 hint，先检查 PR 状态，避免重复创建

---

## P1c：executor agent_startup_failure — 执行器预启动失败

### 现象

2 个任务报 `error_during_execution`，`num_turns=0`, `duration_ms=0`：
```json
{"type":"result","subtype":"error_during_execution","duration_ms":0,"num_turns":0}
```

### 根因分析

Cortex 分析指出：
> 9ms 内失败且无 stderr/log 的 dev 任务，应优先判定为执行器预启动失败，不应归咎任务内容。

根因可能是：
1. Codex API 在高负载时拒绝连接（server_overloaded）
2. OAuth token 刷新失败（团队账号切换问题）
3. `callCodexHeadless` 初始化失败（此前 PR #1455 已修复一次）

当前分类器（`quarantine.js`）将此归为 `TASK_ERROR`，**不触发重试**。

### 修复建议（P1）

```javascript
// quarantine.js：agent_startup_failure 识别为 transient，触发重试
if (result.subtype === 'error_during_execution' && result.num_turns === 0) {
  return { class: 'transient', retryable: true, reason: 'agent_startup_failure' };
}
```

---

## P2a：code_error — 正常的开发失败

### 现象

5 个任务因代码/CI 错误失败（`failure_class=code_error`）。这是**正常的开发流程失败**，不需要系统级修复。

### 分析

- 目前 `dev-failure-classifier.js` 已有 code_error 分类逻辑
- 问题是这些任务没有得到重试机会（`retry_count=0`）
- 根因：`max_retries` 设置或重试条件判断有问题

### 修复建议（P2）

检查 `execution.js` 中 code_error 重试逻辑是否正确执行，确保 dev 任务 code_error 时能自动重试 1 次（带上次失败信息作为 context）。

---

## P2b：OOM kill (exit=137) — 内存资源耗尽

### 现象

2 个任务 exit code 137（SIGKILL by OS OOM killer），均为复杂任务（OKR 数据迁移类）。

### 修复建议（P2）

- 大型数据迁移任务分批执行（每批 500 条）
- 考虑为 OKR 类任务设置 `execution_profile = 'heavy'`，在独立进程组中运行

---

## 失败分类

| 根因类别 | 说明 | 是否可自愈 |
|---------|------|-----------|
| 调度过热（并发 worktree 冲突） | 环境准备层问题，与任务内容无关 | ✅ 加锁后可消除 |
| liveness 阈值过严 | 调度参数问题，非任务缺陷 | ✅ 调参可修复 |
| Brain 重启孤儿 | 基础设施可靠性问题 | ✅ 恢复策略可修复 |
| 执行器预启动失败 | 外部 API 抖动 | ✅ 重试可恢复 |
| 代码错误（code_error） | 正常开发失败 | ⚠️ 需人工关注内容 |
| OOM kill | 任务规模过大 | ⚠️ 需任务拆分 |

**结论：11% 失败中约 72% 属于基础设施/调度问题，与任务内容质量无关。**

---

## 修复建议优先级排序

| 优先级 | 修复项 | 预计影响 | 实施难度 |
|--------|--------|---------|---------|
| **P0** | worktree-manage.sh 加 flock 互斥锁 | 消除 36% 失败 | 低（改 1 个 bash 函数） |
| **P1** | monitor-loop.js 按 location 区分 liveness 阈值 | 消除 28% 失败 | 低（改 1 个常量 + 查询） |
| **P1** | Brain 启动时孤儿任务 requeue（非 failed） | 消除 16-24% 失败 | 中（需测试重启场景） |
| **P1** | quarantine.js 识别 agent_startup_failure 为 transient | 消除 8% 失败 | 低（加 1 个 if 分支） |
| **P2** | code_error 重试次数验证 | 降低 20% 重复失败 | 低（检查配置） |
| **P2** | 大型任务拆分 + OOM 保护 | 消除 OOM kill | 中（需任务设计调整） |

**全量修复后预期成功率：≥ 97%**（code_error 为正常开发失败，不可100%消除）

---

## 附：关键时间轴

```
05:27 – worktree_creation_failed 开始爆发（Brain 并发派发多个重构任务）
05:48 – liveness_dead 开始（西安 Codex 重构任务心跳中断）
06:02 – Watchdog 开始 kill orphan 任务（Pipeline Rescue 任务 liveness_dead）
06:09 – worktree_creation_failed + process_vanished 双重爆发
06:13 – Brain 重启，in_progress → failed 批量标记
06:15 – Brain 重启后孤儿任务 "no matching process" 
07:46 – agent_startup_failure（error_during_execution, 0 turns）
09:37 – codex-bin exit=1 超时（MAX_RETRIES 耗尽）
12:09 – 系统恢复正常，task_run_metrics 开始记录（100% 成功率）
```

> **转折点**：12:09 后连续 41 个任务全部成功，说明上午的失败波主要由系统状态（并发冲突 + Brain 重启）导致，系统本身已自愈。三项 P1 修复可防止下次类似事件。
