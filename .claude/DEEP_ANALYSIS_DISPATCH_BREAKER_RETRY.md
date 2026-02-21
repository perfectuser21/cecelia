# Cecelia Core Brain 深度分析：任务派发、熔断、重试、降级机制

## 执行摘要

分析了 Cecelia 的四个关键可靠性机制，发现：
- ✅ **任务派发成功率统计**：有基础记录，但缺少聚合指标和实时仪表盘
- ✅ **熔断机制**：实现完善，支持自动恢复，但缺少真实流量测试
- ✅ **失败重试策略**：支持分类重试 + 隔离区，但重试数据散落在多处
- ✅ **自动降级机制**：有警觉等级系统 + 威胁评级，但代码复杂度高

---

## 1. 任务派发成功率统计

### 实现状态：部分完成

#### 1.1 成功/失败记录位置

| 位置 | 说明 | 内容 |
|------|------|------|
| **executor.js:1161-1167** | 派发记录 | 追踪 `activeProcesses`（内存map） |
| **tick.js:668-686** | 派发事件 | `emit('task_dispatched')` → `working_memory` |
| **tick.js:771** | 失败记录 | `recordFailure('cecelia-run')` → circuit-breaker |
| **quarantine.js:29** | 隔离阈值 | `FAILURE_THRESHOLD = 3` |
| **circuit-breaker.js:14-15** | 熔断阈值 | `FAILURE_THRESHOLD = 3`, `OPEN_DURATION_MS = 30min` |

#### 1.2 派发流程（完整路径）

```
dispatchNextTask() [tick.js:545]
  ├─ 检查 billing pause [executor.js:562]
  ├─ 检查 slot budget [tick.js:569]
  ├─ 检查 circuit breaker [tick.js:581]
  ├─ 选择下一个任务 [tick.js:586]
  ├─ Pre-flight check [tick.js:598]
  ├─ 更新任务状态→in_progress [tick.js:616]
  ├─ 触发 cecelia-run [tick.js:651]
  │   └─ triggerCeceliaRun() [executor.js:1044]
  │       ├─ 生成 run_id [executor.js:1054]
  │       ├─ 记录 trace [executor.js:1057]
  │       ├─ 重复检查 [executor.js:1076]
  │       ├─ 资源检查 [executor.js:1097]
  │       ├─ 调用 cecelia-bridge [executor.js:1134]
  │       ├─ 追踪到 activeProcesses [executor.js:1161]
  │       └─ 成功返回 runId [executor.js:1180]
  ├─ 广播 WebSocket [tick.js:657]
  ├─ 记录 working_memory [tick.js:676]
  ├─ 发出事件 [tick.js:668]
  └─ 返回 { dispatched: true, task_id, run_id }
```

#### 1.3 成功率指标（缺失）

**有的东西：**
- ✅ Per-task dispatch 结果（success 字段）
- ✅ Circuit breaker 失败计数（failures counter）
- ✅ Quarantine 失败分类统计

**缺失的东西：** ❌
- 没有聚合的 dispatch_success_rate（e.g., "今天 95% 成功率"）
- 没有时间序列指标存储（没有表来记录每小时的成功率）
- 没有实时仪表板（GET /api/brain/dispatch-metrics）
- dispatch 调用没有返回详细原因码（只有 `dispatched: true/false`）

#### 1.4 关键常量

```javascript
// executor.js
const MAX_SEATS = Math.max(Math.floor(Math.min(
  USABLE_MEM_MB / MEM_PER_TASK_MB,  // 单机 8核16GB ≈ 20 slots
  USABLE_CPU / CPU_PER_TASK
)), 2);

const MEM_PER_TASK_MB = 500;      // ~500MB avg per claude
const CPU_PER_TASK = 0.5;          // ~0.5 core avg
const INTERACTIVE_RESERVE = 2;     // 保留给用户的 seat

// tick.js
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);
const DISPATCH_TIMEOUT_MINUTES = 60;  // 派发后 1小时未完成则超时失败

// circuit-breaker.js
const FAILURE_THRESHOLD = 3;              // 3 次失败触发 OPEN
const OPEN_DURATION_MS = 30 * 60 * 1000;  // OPEN 状态持续 30 分钟
```

---

## 2. 熔断机制（Circuit Breaker）

### 实现状态：✅ 完善

#### 2.1 熔断状态机

```
CLOSED ─(3 consecutive failures)─→ OPEN
  ↑                                  │
  │                              (30 min timeout)
  │                                  │
  └─ success in HALF_OPEN ──── HALF_OPEN
```

#### 2.2 核心代码

| 文件 | 行号 | 功能 | 关键代码 |
|------|------|------|---------|
| **circuit-breaker.js** | - | 状态管理 | 内存 Map: `breakers[key] = { state, failures, lastFailureAt, openedAt }` |
| circuit-breaker.js:61-72 | recordSuccess() | 重置状态 | `breakers.set(key, defaultState())` |
| circuit-breaker.js:78-106 | recordFailure() | 记录失败 | `b.failures += 1`, 达到阈值→转 OPEN |
| circuit-breaker.js:35-38 | getState() | 自动转换 | `OPEN → HALF_OPEN` 超时自动 |
| circuit-breaker.js:48-54 | isAllowed() | 检查权限 | 返回 `state !== 'OPEN'` |
| **tick.js:581-582** | dispatchNextTask() | 检查熔断 | `if (!isAllowed('cecelia-run')) return` |

#### 2.3 故障记录流程

```javascript
// tick.js:771 — 当任务超时失败时
recordFailure('cecelia-run');

// circuit-breaker.js 内部
getState('cecelia-run')
  ├─ if (failures >= 3 && state === CLOSED)
  │   └─ state = OPEN
  │       └─ emit('circuit_open', ...) → notifier
  └─ if (state === HALF_OPEN && failure)
      └─ state = OPEN
          └─ emit('circuit_open', ...) with reason='half_open_probe_failed'
```

#### 2.4 恢复机制

- **自动转换**：`OPEN → HALF_OPEN` 后 30 分钟，下一个请求自动探测
- **恢复条件**：成功 1 次 → `CLOSED`
- **手动重置**：`POST /api/brain/circuit-breaker/:key/reset`

#### 2.5 缺失项

❌ **没有真实流量测试**
- 没有集成测试验证 3 次失败 → OPEN 状态
- 没有验证 HALF_OPEN 的探测逻辑

❌ **缺少可观测性**
- 没有 Prometheus 指标导出
- 没有熔断事件的持久化日志

---

## 3. 失败重试策略

### 实现状态：✅ 完善，但复杂

#### 3.1 重试路径

```
Task fails
  ├─ 方案 A: 自动超时重试
  │   └─ autoFailTimedOutTasks() [tick.js:726]
  │       ├─ 检查运行时 > DISPATCH_TIMEOUT_MINUTES (60min)
  │       ├─ killProcess(task.id)
  │       ├─ handleTaskFailure() [quarantine.js]
  │       └─ 隔离 OR 失败
  │
  ├─ 方案 B: 分类重试
  │   └─ classifyFailure() [quarantine.js:300+]
  │       ├─ BILLING_CAP → 等待 reset 时间
  │       ├─ RATE_LIMIT → 指数退避（2min-30min）
  │       ├─ NETWORK → 短延迟重试（30s）
  │       ├─ RESOURCE → 不重试，通知人
  │       └─ TASK_ERROR → 正常失败计数
  │
  ├─ 方案 C: 看门狗 kill → requeueTask()
  │   └─ killProcessTwoStage() [executor.js:392]
  │       ├─ SIGTERM + 10s 等待
  │       ├─ 如果仍活着 → SIGKILL + 2s 验证
  │       └─ requeueTask(taskId, reason) [executor.js:445]
  │           ├─ failure_count += 1
  │           ├─ watchdog_retry_count += 1
  │           ├─ 达到 QUARANTINE_AFTER_KILLS (2) → 隔离
  │           └─ 否则 → 队列，加入 exponential backoff
  │
  └─ 方案 D: 活性探测 → 自动失败
      └─ probeTaskLiveness() [executor.js:1315]
          ├─ 检查 in_progress 任务的进程是否活着
          ├─ 双重确认（suspect 状态）
          └─ 第二次失败 → 自动标记 failed
```

#### 3.2 重试参数

| 参数 | 值 | 来源 | 用途 |
|------|----|----- |------|
| **DISPATCH_TIMEOUT_MINUTES** | 60 | tick.js:27 | 派发后 60min 无完成 → 超时失败 |
| **QUARANTINE_AFTER_KILLS** | 2 | executor.js:447 | watchdog kill 2 次后隔离 |
| **FAILURE_THRESHOLD** | 3 | quarantine.js:29 | 失败 3 次后隔离 |
| **exponential backoff** | 2^n * 60s, max 30min | executor.js:505 | 重试延迟公式 |
| **double-confirm** | 2 ticks | executor.js:1378 | liveness probe 双重确认 |

#### 3.3 分类重试策略（详细）

```javascript
// quarantine.js:64-98 — 失败分类

BILLING_CAP_PATTERNS = [
  /spending\s+cap/i,
  /billing.*limit/i
];
→ 处理：等待 reset 时间（不重试）

RATE_LIMIT_PATTERNS = [
  /too\s+many\s+requests/i,
  /429/,
  /quota\s+exceeded/i
];
→ 处理：指数退避重试

NETWORK_PATTERNS = [
  /ECONNREFUSED|ETIMEDOUT/i,
  /connection\s+reset/i,
  /database.*connection/i
];
→ 处理：短延迟重试（~30s）

AUTH_PATTERNS = [
  /permission\s+denied/i,
  /unauthorized/i
];
→ 处理：不重试，通知人

RESOURCE_PATTERNS = [
  /OOM|Out of memory/i,
  /memory.*exhausted/i
];
→ 处理：不重试，通知人
```

#### 3.4 重试数据存储

| 存储位置 | 字段 | 更新频率 | 用途 |
|----------|------|---------|------|
| tasks.payload | `failure_count` | 每次失败 | 总失败次数 |
| tasks.payload | `watchdog_retry_count` | 看门狗 kill 时 | watchdog 重试计数 |
| tasks.payload | `failure_classification` | 失败时 | 分类和重试策略 |
| tasks.payload | `next_run_at` | 失败时 | 下次运行时间 |
| circuit_breaker.js (内存) | breakers[key].failures | 每次失败 | circuit 计数 |

#### 3.5 缺失项

❌ **重试数据散落**
- 重试次数分散在 3 个地方（failure_count, watchdog_retry_count, circuit failures）
- 没有统一的重试指标表

❌ **缺少重试成功率分析**
- 没有记录"第一次失败的概率" vs "第二次重试成功率"
- 没有按分类统计重试效果

---

## 4. 自动降级机制

### 实现状态：✅ 完善，但可观测性差

#### 4.1 降级层级（Alertness System）

```javascript
// alertness/index.js:26-32

SLEEPING (0)   ← 无任务
    ↓
CALM (1)       ← 正常运行 [default]
    ↓
AWARE (2)      ← 轻微异常（e.g., 20% 错误率）
    ↓
ALERT (3)      ← 明显异常（e.g., 40% 错误率）
    ↓
PANIC (4)      ← 严重异常（e.g., 70% 错误率）
```

#### 4.2 降级触发条件

```javascript
// alertness/index.js:139-149

determineTargetLevel(healthScore, diagnosis):
  ├─ diagnosis.severity === 'critical'   → PANIC (4)
  ├─ diagnosis.severity === 'high'       → ALERT (3)
  ├─ diagnosis.severity === 'medium'     → AWARE (2)
  └─ else                                → CALM (1)

// 健康分数权重（alertness/metrics.js:315-321）
health_score = {
  memory: 25%,
  cpu: 25%,
  responseTime: 20%,
  errorRate: 20%,
  queueDepth: 10%
} × severity
```

#### 4.3 降级响应动作

| 等级 | 触发器 | 响应 | 代码位置 |
|------|--------|------|---------|
| **AWARE** (2) | 任何异常 | 增加监控频率 | alertness/escalation.js |
| **ALERT** (3) | 30% 错误率 OR 队列深度>50 | 启用 drain mode (停止派发) | alertness-actions.js |
| **PANIC** (4) | 70% 错误率 OR OOM | 杀死低优先级任务 + drain | alertness-actions.js |

#### 4.4 具体降级指标

```javascript
// alertness/metrics.js:21-46

THRESHOLDS = {
  memory: { normal: 150MB, warning: 200MB, danger: 300MB },
  cpu: { normal: 30%, warning: 50%, danger: 80% },
  responseTime: { normal: 2s, warning: 5s, danger: 10s },
  errorRate: { normal: 10%, warning: 30%, danger: 50% },
  queueDepth: { normal: 10, warning: 20, danger: 50 }
}
```

#### 4.5 Slot 预算限制（三池模型）

```javascript
// slot-allocator.js:23-27

Pool A (Cecelia 保留)  ← 1 slot（OKR 分解、RCA）
Pool B (用户保留)      ← 2-4 slots（headed sessions + headroom）
Pool C (任务派发)      ← 剩余（动态缩放，按 resource pressure）

当 user.mode = 'team' (3+ headed sessions)
  → 所有 Pool 缩小
  → Pool C = min(remaining, pressure * effectiveSlots)
```

#### 4.6 监控循环（Monitor Loop）

```javascript
// monitor-loop.js:31

MONITOR_INTERVAL_MS = 30000 // 每 30s 扫一次

检查项：
  ├─ detectStuckRuns()      → 卡住的任务 (5min 无心跳)
  ├─ detectFailureSpike()   → 失败率激增 (>30% in 1h)
  └─ detectResourcePressure() → 资源压力 (CPU/Mem)
```

#### 4.7 缺失项

❌ **可观测性差**
- 没有 alertness 等级历史表
- 没有 GET /api/brain/alertness-history 端点
- 没有降级触发的详细日志

❌ **缺少 A/B 测试数据**
- 没有对比"降级好处" vs "降级副作用"
- 没有 SLO 定义（e.g., "99% 任务在 10min 内完成"）

---

## 5. 关键常量总汇

### 5.1 资源限制

```javascript
// executor.js
TOTAL_MEM_MB = 16384;                    // 系统总内存
MEM_PER_TASK_MB = 500;                   // 单任务期望
CPU_PER_TASK = 0.5;                      // 单任务期望
USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;      // 80% 可用
USABLE_CPU = CPU_CORES * 0.8;            // 80% 可用
MAX_SEATS = min(USABLE_MEM / 500, USABLE_CPU / 0.5) = 12-16
LOAD_THRESHOLD = CPU_CORES * 0.85 - 1.0 // CPU 阈值
MEM_AVAILABLE_MIN_MB = 3398              // 最小可用内存
SWAP_USED_MAX_PCT = 70;                  // swap 硬限
```

### 5.2 派发和超时

```javascript
// tick.js
TICK_INTERVAL_MINUTES = 5;               // 每 5 分钟一次 tick
TICK_LOOP_INTERVAL_MS = 5000;            // 循环间隔 5s
TICK_TIMEOUT_MS = 60 * 1000;             // tick 最大执行时间 60s
DISPATCH_TIMEOUT_MINUTES = 60;           // 派发超时 60min
AUTO_DISPATCH_MAX = MAX_SEATS - 2;       // 最多派发 10-14 个任务
```

### 5.3 熔断和重试

```javascript
// circuit-breaker.js
FAILURE_THRESHOLD = 3;                   // 3 次失败→OPEN
OPEN_DURATION_MS = 1800000;              // 30 分钟
HALF_OPEN_TIMEOUT = auto (30min)         // 自动转 HALF_OPEN

// executor.js (重试)
QUARANTINE_AFTER_KILLS = 2;              // watchdog kill 2 次→隔离
exponential_backoff_max = 1800s (30min)  // 最大延迟

// quarantine.js
FAILURE_THRESHOLD = 3;                   // 总失败 3 次→隔离
MAX_PRD_LENGTH = 50000;                  // 可疑输入检测
```

### 5.4 监控和降级

```javascript
// monitor-loop.js
MONITOR_INTERVAL_MS = 30000;             // 30s 扫一次
STUCK_THRESHOLD_MINUTES = 5;             // 5min 无心跳→卡住
FAILURE_SPIKE_THRESHOLD = 0.3;           // 30% 失败率→激增
RESOURCE_PRESSURE_THRESHOLD = 0.85;      // 85% 压力→警告

// alertness/metrics.js
errorRate.danger = 50%;                  // 50% 失败→PANIC
queueDepth.danger = 50;                  // 队列深度>50→PANIC

// watchdog.js
STARTUP_GRACE_SEC = 60;                  // 60s 启动宽限
RSS_KILL_MB = min(2400, 35% of total);   // RSS 硬限
CPU_SUSTAINED_PCT = 95%;                 // 95% CPU + 30s→kill
```

---

## 6. 缺失的监控点

### 6.1 关键指标缺失

| 指标 | 定义 | 现状 | 优先级 |
|------|------|------|--------|
| **dispatch_success_rate** | 派发成功 / 派发尝试 | ❌ 缺失 | 🔴 P0 |
| **dispatch_attempts_per_min** | 每分钟派发次数 | ✅ 可从 event 推断 | 🟡 P2 |
| **avg_dispatch_latency_ms** | 从 queued→in_progress 时间 | ❌ 缺失 | 🟡 P2 |
| **retry_success_rate** | 重试后成功 / 重试总数 | ❌ 缺失 | 🔴 P0 |
| **circuit_breaker_trips** | 熔断触发总数（历史） | ❌ 仅内存 | 🟡 P2 |
| **quarantine_inflow_rate** | 每小时隔离任务数 | ✅ 可从 DB 查 | 🟡 P2 |
| **alertness_level_duration** | 各等级持续时间 | ❌ 缺失历史 | 🟡 P2 |
| **watchdog_kill_effectiveness** | kill 后重试成功率 | ❌ 缺失 | 🟡 P2 |

### 6.2 缺失的数据库表

```sql
-- 建议新增表
CREATE TABLE dispatch_metrics (
  timestamp TIMESTAMP,
  attempts INT,
  successes INT,
  failures INT,
  avg_latency_ms INT,
  reason_breakdown JSONB,  -- e.g. { no_task: 10, circuit_open: 3, ... }
  PRIMARY KEY (timestamp)
);

CREATE TABLE circuit_breaker_history (
  key TEXT,
  state TEXT,
  failures INT,
  transition_at TIMESTAMP,
  reason TEXT
);

CREATE TABLE alertness_history (
  level INT,
  level_name TEXT,
  reason TEXT,
  metrics JSONB,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE TABLE retry_analytics (
  task_id UUID,
  attempt_num INT,
  failure_classification TEXT,
  success BOOLEAN,
  retry_delay_ms INT,
  attempted_at TIMESTAMP
);
```

---

## 7. 执行路径摘要

### 7.1 正常流程

```
User submits task
  └─ POST /api/brain/action/create-task
      └─ Task inserted (status='queued')

[Every 5 minutes] executeTick()
  ├─ planNextTask() → select from queued
  └─ dispatchNextTask()
      ├─ slot budget check
      ├─ circuit breaker check
      ├─ pre-flight check
      ├─ triggerCeceliaRun()
      │   └─ cecelia-bridge spawns claude process
      └─ record to activeProcesses

[During execution]
  ├─ liveness probe (every tick)
  │   └─ check /proc/pid exists
  ├─ watchdog sample (every 5-30s)
  │   └─ check RSS/CPU from /proc
  └─ heartbeat from claude process
      └─ execu callback → recordHeartbeat()

[On completion]
  ├─ claude process exits
  ├─ execution-callback received
  │   └─ update task status = 'completed'
  └─ removeActiveProcess(task.id)
```

### 7.2 失败流程

```
Task failure detected
  ├─ Via timeout: autoFailTimedOutTasks() [>60min]
  │   └─ killProcess() → await requeueTask()
  │       └─ failure_count++, watchdog_retry_count++
  │
  ├─ Via liveness: probeTaskLiveness() [2nd probe failure]
  │   └─ updateTaskStatus(task, 'failed')
  │       └─ emit error_details with diagnostic
  │
  └─ Via callback: handleTaskFailure() [from quarantine]
      └─ classifyFailure()
          ├─ BILLING_CAP → wait until reset time
          ├─ RATE_LIMIT → exponential backoff
          ├─ NETWORK → short delay
          └─ TASK_ERROR / others → update status
```

### 7.3 熔断流程

```
On dispatch failure:
  └─ recordFailure('cecelia-run')
      └─ circuit-breaker.js
          ├─ failures++
          ├─ if (failures >= 3)
          │   └─ state = 'OPEN'
          │       └─ emit('circuit_open', ...)
          │           └─ notifier sends alert
          └─ next tick: isAllowed('cecelia-run') = false
              └─ dispatchNextTask returns { dispatched: false, reason: 'circuit_breaker_open' }

[After 30 minutes]
  ├─ getState('cecelia-run')
  │   └─ state = 'HALF_OPEN' (auto-transition)
  └─ next successful dispatch
      └─ recordSuccess('cecelia-run')
          └─ state = 'CLOSED'
              └─ emit('circuit_closed', ...)
```

---

## 8. 建议的改进（不涉及架构变更）

### 8.1 立即行动（P0）

1. **添加 dispatch_metrics 表和 API**
   ```javascript
   // 每次 dispatchNextTask 返回后
   await recordDispatchMetric({
     success: result.dispatched,
     reason: result.reason,
     task_type: task.task_type,
     timestamp: new Date()
   });
   
   // GET /api/brain/dispatch-stats
   return {
     last_hour: { attempts, successes, failures, rate },
     last_24h: { ... },
     by_reason: { no_task, circuit_open, pool_exhausted, ... }
   };
   ```

2. **持久化 circuit breaker 状态**
   ```sql
   INSERT INTO circuit_breaker_history (key, state, failures, transition_at, reason)
   VALUES (...);
   ```

3. **统一重试指标**
   - 将 `failure_count` + `watchdog_retry_count` 合并为 `total_retries`
   - 每次重试记录到 `retry_analytics` 表

### 8.2 中期改进（P1）

1. **Alertness 历史记录**
   - 每次级别转换插入 alertness_history
   - 添加 GET /api/brain/alertness-timeline

2. **重试有效性分析**
   - 计算 retry_success_rate = 重试成功 / 总重试
   - 按分类对比（billing vs rate_limit vs network）

3. **SLO 定义**
   - P99 dispatch latency < 5 秒
   - dispatch success rate > 95%
   - 平均任务完成时间 < 10 分钟

### 8.3 长期改进（P2）

1. **ML 模型优化**
   - 根据历史失败率预测下一个 task 的成功率
   - 自适应调整 exponential backoff

2. **可视化仪表板**
   - 实时 dispatch 成功率曲线
   - 熔断事件时间线
   - 警觉等级走势图

---

## 附录：文件清单

### 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| executor.js | 1662 | 派发、进程管理、重试、billing pause |
| tick.js | 1000+ | tick loop、dispatch、超时检测、quarantine |
| circuit-breaker.js | 138 | 熔断状态机 |
| quarantine.js | 500+ | 失败分类、隔离、重试策略 |
| alertness/index.js | 300+ | 等级转换、诊断、响应 |
| alertness/metrics.js | 358 | 指标收集、健康分数 |
| slot-allocator.js | 278 | 三池模型、资源限制 |
| watchdog.js | 278 | RSS/CPU 采样、runaway 检测 |
| monitor-loop.js | 300+ | 卡住/激增/压力 检测 |

### 测试文件

- `__tests__/circuit-breaker.test.js` — ✅ 有测试
- `__tests__/executor-retry-strategy.test.js` — ✅ 有测试
- `__tests__/tick-watchdog-quarantine.test.js` — ✅ 有测试
- `__tests__/failure-classification.test.js` — ✅ 有测试

### 缺失的测试

- ❌ dispatch success rate 聚合
- ❌ circuit breaker persistence
- ❌ alertness level transitions
- ❌ slot budget three-pool enforcement

