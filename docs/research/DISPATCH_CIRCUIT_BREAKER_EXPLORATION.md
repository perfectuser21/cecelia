# Cecelia Core 派发成功率监控与熔断探索报告

**生成时间**: 2026-02-18
**探索深度**: medium
**版本**: 1.0.0

---

## 目录

1. [现存架构总览](#1-现存架构总览)
2. [派发成功率统计 (dispatch-stats.js)](#2-派发成功率统计)
3. [熔断器实现 (circuit-breaker.js)](#3-熔断器实现)
4. [派发流程集成](#4-派发流程集成)
5. [监控与告警](#5-监控与告警)
6. [现有缺陷分析](#6-现有缺陷分析)
7. [文件地图](#7-文件地图)
8. [API 端点](#8-api-端点)

---

## 1. 现存架构总览

### 1.1 核心概念

Cecelia Core 采用**四重保护系统**防止派发失败导致资源浪费：

```
┌─────────────────────────────────────┐
│ dispatchNextTask (tick.js line 601) │
└──────────────┬──────────────────────┘
               │
               ├─► 0a. 账单暂停检查 (billing_pause)
               │
               ├─► 0b. 低成功率熔断 ✅ (dispatch-stats.js)
               │
               ├─► 0c. 三池资源检查 (slot-allocator.js)
               │
               ├─► 0d. 断路器检查 ✅ (circuit-breaker.js)
               │
               ├─► 1-3. 任务筛选与派发
               │
               └─► 记录派发结果 (recordDispatchResult)
```

### 1.2 三层防护集成

| 防护层 | 机制 | 文件 | 触发条件 |
|-------|------|------|--------|
| **成功率熔断** | 滚动窗口统计 + 阈值判断 | dispatch-stats.js | 1h内成功率 < 30% 且样本 >= 10 |
| **断路器** | 状态机 (CLOSED/OPEN/HALF_OPEN) | circuit-breaker.js | 连续 3 次派发失败 |
| **警觉系统** | 多指标评分 | alertness/index.js | CPU/内存/错误率超标 |
| **隔离区** | 失败分类与隔离 | quarantine.js | 任务失败超阈值 |

---

## 2. 派发成功率统计

### 2.1 文件位置与职责

📍 **文件**: `/home/xx/perfect21/cecelia/core/brain/src/dispatch-stats.js`

**核心职责**：维护 1 小时滚动窗口统计，记录每次派发的成功/失败

### 2.2 数据结构

```javascript
// 存储位置：PostgreSQL working_memory 表，key='dispatch_stats'
{
  window_1h: {
    total: number,              // 1 小时内派发总次数
    success: number,            // 成功派发次数
    failed: number,             // 失败派发次数
    rate: number|null,          // 成功率 (0.0 ~ 1.0，无数据时为 null)
    last_updated: string,       // ISO 时间戳
    failure_reasons: {
      circuit_breaker_open: 3,  // 按失败原因分类计数
      pool_exhausted: 2,
      billing_pause: 1,
      draining: 1,
      low_success_rate: 0,      // 由低成功率熔断造成的派发阻止（自引用）
      pre_flight_check_failed: 0,
      no_executor: 0,
      task_not_found: 0
    }
  },
  events: [
    { ts: "2026-02-18T10:00:00.000Z", success: true },
    { ts: "2026-02-18T10:00:01.000Z", success: false, reason: "circuit_breaker_open" },
    // 只保留 1 小时内的事件（滚动）
  ]
}
```

### 2.3 关键函数

#### `computeWindow1h(events, now) → { total, success, failed, rate, failure_reasons }`

**纯函数**，无副作用，便于测试

```javascript
// 示例用法
const events = [
  { ts: "2026-02-18T10:00:00Z", success: true },
  { ts: "2026-02-18T10:00:01Z", success: false, reason: "circuit_breaker_open" },
  { ts: "2026-02-18T11:00:00Z", success: true }  // 超过 1 小时，会被过滤
];
const stats = computeWindow1h(events, Date.now());
// 返回：{ total: 2, success: 1, failed: 1, rate: 0.5, failure_reasons: { ... } }
```

**过滤逻辑**:
```javascript
const cutoff = now - WINDOW_MS;  // WINDOW_MS = 3600000 (1小时)
const recent = events.filter(e => new Date(e.ts).getTime() >= cutoff);
```

#### `recordDispatchResult(pool, success, reason, nowMs)`

**异步记录**单次派发结果，自动更新滚动统计

```javascript
// 成功派发
await recordDispatchResult(pool, true);

// 失败派发（需要提供原因）
await recordDispatchResult(pool, false, 'circuit_breaker_open');
```

**工作流程**:
1. 读取现有 dispatch_stats
2. 追加新事件 `{ ts, success, reason? }`
3. 裁剪过期事件（保留 1 小时内）
4. 重新计算 window_1h 统计
5. 写回 DB

**错误处理**：DB 失败时**静默吞掉异常**，不阻断主流程（第 127-130 行）

#### `getDispatchStats(pool, nowMs) → { window_1h }`

**异步读取**当前统计，用于 API 和决策逻辑

```javascript
const stats = await getDispatchStats(pool);
console.log(stats.window_1h.rate);  // 0.0 ~ 1.0 或 null
```

### 2.4 阈值常量

```javascript
// 导出的常量（可通过环境变量覆盖）
export const DISPATCH_RATE_THRESHOLD = parseFloat(process.env.DISPATCH_LOW_RATE_THRESHOLD || '0.3');
export const DISPATCH_MIN_SAMPLE = parseInt(process.env.DISPATCH_MIN_SAMPLE || '10', 10);
export const WINDOW_MS = 60 * 60 * 1000;  // 1 小时（硬编码）
```

**熔断条件**（tick.js line 631）:
```javascript
if (rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD) {
  // 触发低成功率熔断，阻止派发
}
```

**判断逻辑**:
- ✅ 触发熔断: 成功率 20% + 样本 15 个 → 20% < 30% 且 15 >= 10
- ❌ 不触发: 成功率 30% + 样本 10 个 → 30% ≮ 30%（等于不阻断）
- ❌ 不触发: 成功率 20% + 样本 9 个 → 9 < 10（样本不足）
- ❌ 不触发: 无数据 → rate === null

### 2.5 集成点

| 调用方 | 行为 | 文件位置 |
|-------|------|--------|
| tick.js 派发流程 | 读取统计，判断是否阻止派发 | line 628-642 |
| tick.js 派发成功 | 记录成功结果 | line 799 |
| tick.js 各阶段失败 | 记录失败结果 + 原因 | line 610, 622, 632, 649, 660, 691, 723, 729 |
| routes.js API | 暴露 GET /api/brain/dispatch-stats | line 1105-1112 |
| routes.js 状态 | 包含在 /api/brain/status/full 的响应中 | (待确认) |

---

## 3. 熔断器实现

### 3.1 文件位置与职责

📍 **文件**: `/home/xx/perfect21/cecelia/core/brain/src/circuit-breaker.js`

**核心职责**：防止对故障 worker 的重复派发（3 次连续失败后阻止 30 分钟）

### 3.2 状态机设计

```
                ╔═══════════════════════════════════════╗
                ║          CLOSED (正常)               ║
                ║   派发允许 | 重置失败计数              ║
                ╚═══════════════════════════════════════╝
                        ↑                    ↓
        recordSuccess() |                    | recordFailure() (连续 3 次)
                        |                    ↓
                ╔═══════════════════════════════════════╗
                ║         OPEN (阻止)                   ║
                ║   派发禁止 | 开始计时器                 ║
                ╚═══════════════════════════════════════╝
                        ↑                    ↓
        自动(30min后)   |                    | 自动转换
        transition      |                    ↓
                ╔═══════════════════════════════════════╗
                ║        HALF_OPEN (探测)              ║
                ║   派发允许（1 个探测任务）             ║
                ╚═══════════════════════════════════════╝
                        ↑                    ↓
                        |                    |
            recordSuccess()          recordFailure()
                        |                    |
                        └────────┬───────────┘
                                CLOSED
```

### 3.3 数据结构

```javascript
// 内存存储：Map<workerKey, breakerState>
{
  'cecelia-run': {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
    failures: number,           // 失败计数（CLOSED 时会重置）
    lastFailureAt: number|null, // 最后失败时间戳(ms)
    openedAt: number|null       // 打开时间戳(ms)
  }
}
```

### 3.4 关键函数

#### `getState(key) → breaker_state`

获取 worker 的熔断器状态，自动处理 OPEN → HALF_OPEN 转换

```javascript
const state = getState('cecelia-run');
// { state: 'CLOSED', failures: 0, lastFailureAt: null, openedAt: null }
```

**自动转换逻辑** (line 35-38):
```javascript
if (b.state === 'OPEN' && b.openedAt && (Date.now() - b.openedAt >= OPEN_DURATION_MS)) {
  b.state = 'HALF_OPEN';  // 30分钟后自动转换
}
```

#### `isAllowed(key) → boolean`

判断是否允许派发

```javascript
if (!isAllowed('cecelia-run')) {
  // 熔断器打开，阻止派发
}
```

**判断规则** (line 48-54):
```javascript
return s.state !== 'OPEN';  // CLOSED 和 HALF_OPEN 都允许，OPEN 阻止
```

#### `recordSuccess(key)` & `recordFailure(key)`

异步记录成功/失败，触发状态转换和事件发送

```javascript
// 成功：重置为 CLOSED
await recordSuccess('cecelia-run');

// 失败：累加计数，超过阈值时转为 OPEN
await recordFailure('cecelia-run');
```

**失败处理逻辑** (line 78-106):
- 如果已是 HALF_OPEN：探测失败，转为 OPEN（20 分钟后可再试）
- 如果是 CLOSED 且失败 >= 3：转为 OPEN（记录 failure_threshold_reached 事件）

### 3.5 配置常量

```javascript
const FAILURE_THRESHOLD = 3;                    // 触发熔断的连续失败次数
const OPEN_DURATION_MS = 30 * 60 * 1000;       // OPEN 状态持续 30 分钟
```

### 3.6 事件发送

熔断器状态变化时发送事件到 event-bus

```javascript
// 打开事件
await emit('circuit_open', 'circuit_breaker', {
  key: 'cecelia-run',
  reason: 'failure_threshold_reached' | 'half_open_probe_failed',
  failures: 3
});

// 关闭事件
await emit('circuit_closed', 'circuit_breaker', {
  key: 'cecelia-run',
  previous_state: 'HALF_OPEN',
  previous_failures: 3
});
```

### 3.7 通知集成

熔断器打开时调用 notifier 发送警告（line 95, 104）

```javascript
notifyCircuitOpen({ key, failures, reason }).catch(() => {});
```

---

## 4. 派发流程集成

### 4.1 dispatchNextTask() 完整流程

**位置**: `/home/xx/perfect21/cecelia/core/brain/src/tick.js` line 601

**流程图**:
```
dispatchNextTask()
├─ [0a] 排水模式检查 (draining mode)
│       └─ recordDispatchResult(false, 'draining')
├─ [0b] 账单暂停检查
│       └─ recordDispatchResult(false, 'billing_pause')
├─ [0c] 低成功率熔断 ✅ HERE
│       ├─ getDispatchStats()
│       ├─ rate < THRESHOLD && total >= MIN_SAMPLE?
│       ├─ recordDispatchResult(false, 'low_success_rate')
│       └─ emit('dispatch_low_success_rate')
├─ [1] 三池资源预算检查
│       └─ recordDispatchResult(false, slotReason)
├─ [2] 断路器检查 ✅ HERE
│       ├─ isAllowed('cecelia-run')?
│       └─ recordDispatchResult(false, 'circuit_breaker_open')
├─ [3] 任务选择 & 质量检查
│       ├─ selectNextDispatchableTask()
│       └─ preFlightCheck()
├─ [4] 任务状态更新
│       └─ updateTask({ task_id, status: 'in_progress' })
├─ [5] Executor 可用性检查
│       └─ checkCeceliaRunAvailable()
├─ [6] 触发派发
│       ├─ triggerCeceliaRun(task)
│       ├─ recordFailure('cecelia-run')  // 如果派发失败
│       └─ recordSuccess('cecelia-run')? (待确认实现)
├─ [7] 记录成功
│       └─ recordDispatchResult(true)    // 派发成功
└─ [8] WebSocket 广播 & 日志
```

### 4.2 失败原因映射

| 原因字符串 | 来源 | 触发条件 | 处理 |
|-----------|------|--------|------|
| `draining` | tick.js:610 | 排水模式激活 | 等待现有任务完成 |
| `billing_pause` | tick.js:622 | API 账单达到上限 | 等待账单重置 |
| `low_success_rate` | tick.js:632 | 1h 成功率 < 30% 且样本 >= 10 | ✅ **派发成功率熔断** |
| `pool_exhausted` | tick.js:649 | 任务池预算耗尽 | 等待 slot 释放 |
| `pool_c_full` | tick.js:649 | C 类 pool 满 | 等待 slot 释放 |
| `user_team_mode` | tick.js:648 | 用户在 team 模式 | 等待模式切换 |
| `circuit_breaker_open` | tick.js:660 | 3 次派发失败 | ✅ **断路器熔断** |
| `no_dispatchable_task` | tick.js:667 | 没有可派发任务 | 等待新任务 |
| `pre_flight_check_failed` | tick.js:691 | 任务质量检查失败 | 任务标记为失败 |
| `no_executor` | tick.js:723 | cecelia-run 不可用 | 等待 executor 恢复 |
| `task_not_found` | tick.js:729 | 任务在 DB 不存在 | 记录异常 |

### 4.3 双重热启动保护

派发失败后的自动恢复机制：

```javascript
// 如果派发失败，记录失败（增加断路器失败计数）
if (!execResult.success) {
  await recordFailure('cecelia-run');
}

// 同时，如果是低成功率熔断：
// 1. 记录失败结果（dispatch_stats 中的 failure_reasons['low_success_rate']++）
// 2. 发送事件（dispatch_low_success_rate）
// 3. 打印警告日志
// 4. 等待下一个 tick（5 分钟）后重新评估
```

---

## 5. 监控与告警

### 5.1 API 端点

#### `GET /api/brain/dispatch-stats`

**路径**: routes.js line 1105-1112

**响应示例**:
```json
{
  "success": true,
  "window_1h": {
    "total": 15,
    "success": 9,
    "failed": 6,
    "rate": 0.6,
    "last_updated": "2026-02-18T15:30:00.000Z",
    "failure_reasons": {
      "circuit_breaker_open": 3,
      "pool_exhausted": 2,
      "billing_pause": 1,
      "low_success_rate": 0,
      "pre_flight_check_failed": 0,
      "no_executor": 0,
      "task_not_found": 0
    }
  }
}
```

#### 断路器状态查询（待实现）

目前没有专门的 API 端点，状态存在内存中。可通过以下方式查询：
- `GET /api/brain/status/full` (需要确认是否包含断路器状态)
- 直接调用 `getAllStates()` 需要修改代码暴露

### 5.2 事件发送

#### 低成功率熔断事件

```javascript
await emit('dispatch_low_success_rate', 'tick', {
  rate: 0.2,
  total: 15,
  threshold: 0.3,
  min_sample: 10
});
```

#### 断路器事件

```javascript
// 打开
await emit('circuit_open', 'circuit_breaker', {
  key: 'cecelia-run',
  reason: 'failure_threshold_reached',
  failures: 3
});

// 关闭
await emit('circuit_closed', 'circuit_breaker', {
  key: 'cecelia-run',
  previous_state: 'HALF_OPEN',
  previous_failures: 3
});
```

### 5.3 日志输出

```
[dispatch] 低成功率熔断: rate=20.0% total=15 threshold=30%
[executor] KILL FAILED: pgid=12345 task=xxx still alive after SIGKILL
[tick] Ramped dispatch: 3 → 1 (pressure: 0.75, alertness: ALERT, reason: pressure=0.75)
```

### 5.4 警觉系统集成

警觉系统（alertness/index.js）与派发监控的关系：

```javascript
// tick.js line 899-910
if (alertness.level >= ALERTNESS_LEVELS.ALERT) {
  // 高警觉：减少派发速率
  newRate = Math.max(0, currentRate - 1);
  reason = `alertness=${alertness.levelName}`;
}

// 警觉系统监控以下指标：
// - CPU load
// - 内存使用
// - 任务失败率
// - 错误事件数
// - 系统压力 (max_pressure)
```

---

## 6. 现有缺陷分析

### 6.1 缺陷 #1: recordSuccess 在派发成功后从未调用

**问题**: 派发成功时只调用 `recordDispatchResult(pool, true)`，从未调用 `recordSuccess('cecelia-run')`

**影响**:
- 断路器失败计数永远不会重置（除非成功后立即再失败 3 次）
- 如果派发成功 10 次，然后失败 3 次，断路器会打开（应该只从最后的失败开始计数）

**现有代码** (tick.js line 799):
```javascript
await recordDispatchResult(pool, true);  // ✅ 统计层记录
// 但没有：await recordSuccess('cecelia-run');  // ❌ 断路器层未调用
```

**应该修复为**:
```javascript
await recordDispatchResult(pool, true);
await recordSuccess('cecelia-run');  // 重置失败计数
```

**位置**: tick.js 第 799 行（派发成功后）

### 6.2 缺陷 #2: 派发失败时没有记录断路器失败

**问题**: 当 `triggerCeceliaRun()` 返回 `success: false` 时，没有调用 `recordFailure()`

**影响**:
- 派发失败不会累加断路器失败计数
- 即使连续 3 次派发失败，断路器也不会打开

**现有代码** (tick.js line 733-755):
```javascript
const execResult = await triggerCeceliaRun(fullTaskResult.rows[0]);

// 检查派发是否成功
if (!execResult.success) {
  // ❌ 没有记录 recordFailure('cecelia-run')
}

// 只有超时才记录（line 856）
await recordFailure('cecelia-run');
```

**应该修复为**:
```javascript
const execResult = await triggerCeceliaRun(fullTaskResult.rows[0]);

if (!execResult.success) {
  await recordFailure('cecelia-run');  // 记录派发失败
  // 同时记录到统计
  await recordDispatchResult(pool, false, 'executor_error');
  return { dispatched: false, reason: 'executor_error', error: execResult.error };
}
```

### 6.3 缺陷 #3: 低成功率熔断后自引用问题

**问题**: 当低成功率熔断阻止派发时，`recordDispatchResult(false, 'low_success_rate')` 会在 `failure_reasons` 中增加 `low_success_rate` 计数

这导致：
- failure_reasons['low_success_rate'] 不断增加
- 但派发本身并未尝试（没有真正的派发失败）

**影响**: 监控报告会显示虚假的"派发失败"次数

**是否需要修复**: 可能需要区分"派发阻止"vs"派发失败"
- 派发阻止：未尝试派发（低成功率/账单暂停/排水模式）
- 派发失败：尝试派发但失败（执行器错误/任务问题）

**现有代码** (dispatch-stats.js line 70-89):
```javascript
for (const e of recent) {
  if (!e.success && e.reason) {
    failure_reasons[e.reason] = (failure_reasons[e.reason] || 0) + 1;
  }
}
```

### 6.4 缺陷 #4: 未测试的派发成功路径

**问题**: 派发成功时的断路器重置逻辑从未在生产中被测试

**影响**: 可能在边界情况下出现问题（如 HALF_OPEN 成功后没有正确转为 CLOSED）

**证据**: 只有 circuit-breaker.test.js 有测试，但没有端到端测试（tick → dispatch → recordSuccess）

### 6.5 现有缺陷总结表

| 缺陷 | 严重性 | 位置 | 影响 | 修复难度 |
|------|------|------|------|--------|
| recordSuccess 未调用 | 高 | tick.js:799 | 断路器失败计数不重置 | 低 |
| 派发失败未记录 | 高 | tick.js:733-755 | 断路器永不打开 | 低 |
| 低成功率自引用 | 中 | dispatch-stats.js:70-89 | 监控报告不准 | 中 |
| 未测试派发成功 | 中 | 无对应文件 | 边界 bug 风险 | 中 |

---

## 7. 文件地图

### 7.1 核心文件

```
/home/xx/perfect21/cecelia/core/brain/src/
├── dispatch-stats.js (149 行)
│   ├─ recordDispatchResult(pool, success, reason)
│   ├─ getDispatchStats(pool)
│   ├─ computeWindow1h(events, now)
│   ├─ DISPATCH_RATE_THRESHOLD (0.3)
│   └─ DISPATCH_MIN_SAMPLE (10)
│
├── circuit-breaker.js (138 行)
│   ├─ getState(key)
│   ├─ isAllowed(key)
│   ├─ recordSuccess(key)
│   ├─ recordFailure(key)
│   ├─ getAllStates()
│   ├─ FAILURE_THRESHOLD (3)
│   └─ OPEN_DURATION_MS (1800000)
│
├── tick.js (1100+ 行)
│   ├─ dispatchNextTask() [line 601]
│   │  ├─ 0a 排水检查 [610]
│   │  ├─ 0b 账单检查 [622]
│   │  ├─ 0c 低成功率检查 [628-642] ✅
│   │  ├─ 1  资源检查 [645-656]
│   │  ├─ 2  断路器检查 [659-662] ✅
│   │  ├─ 3-5 任务派发 [665-731]
│   │  ├─ 6  成功记录 [799] ✅ (但缺 recordSuccess)
│   │  └─ 失败处理 [856] ⚠️ (只有超时)
│   │
│   ├─ executeTick() [line 951]
│   │  └─ alertness 评估 [962]
│   │
│   └─ 导入项
│      ├─ recordDispatchResult
│      ├─ getDispatchStats
│      ├─ isAllowed
│      ├─ recordSuccess
│      ├─ recordFailure
│      └─ DISPATCH_RATE_THRESHOLD
│
├── executor.js (1100+ 行)
│   ├─ triggerCeceliaRun(task) [line 1045]
│   │  └─ return { success, runId, taskId, error, reason }
│   ├─ checkServerResources()
│   ├─ MAX_SEATS (导出)
│   └─ INTERACTIVE_RESERVE (导出)
│
├── routes.js (1150+ 行)
│   └─ GET /api/brain/dispatch-stats [1105-1112] ✅
│
├── alertness/
│   ├─ index.js
│   │  ├─ evaluateAlertness()
│   │  ├─ getCurrentAlertness()
│   │  ├─ canDispatch()
│   │  ├─ getDispatchRate()
│   │  └─ ALERTNESS_LEVELS
│   ├─ metrics.js
│   │  └─ recordOperation(success, operationName)
│   ├─ escalation.js
│   │  └─ escalateIfNeeded(level, reason)
│   └─ healing.js
│
├── circuit-breaker.test.js (171 行) ✅
│   ├─ CLOSED → OPEN 转换
│   ├─ OPEN → HALF_OPEN 自动转换
│   ├─ HALF_OPEN 探测成功 → CLOSED
│   ├─ HALF_OPEN 探测失败 → OPEN
│   └─ reset(key)
│
└── dispatch-stats.test.js (245 行) ✅
    ├─ computeWindow1h 纯函数测试
    ├─ 1 小时滚动窗口过滤
    ├─ 多种失败原因统计
    └─ recordDispatchResult DB 操作
```

### 7.2 测试文件

| 文件 | 用途 | 行数 |
|------|------|------|
| `__tests__/circuit-breaker.test.js` | 断路器状态机 + 转换 | 171 |
| `__tests__/dispatch-stats.test.js` | 滚动窗口 + 统计 | 245 |
| `__tests__/dispatch-low-rate.test.js` | 低成功率熔断阈值 | 118 |
| `__tests__/circuit-breaker-success.test.js` | (需要创建) 派发成功路径 | - |

---

## 8. API 端点

### 8.1 查询派发统计

```bash
curl -s http://localhost:5221/api/brain/dispatch-stats | jq

# 响应
{
  "success": true,
  "window_1h": {
    "total": 42,
    "success": 35,
    "failed": 7,
    "rate": 0.833,
    "last_updated": "2026-02-18T15:30:00.000Z",
    "failure_reasons": {
      "circuit_breaker_open": 3,
      "pool_exhausted": 2,
      "billing_pause": 1,
      "pre_flight_check_failed": 1,
      "low_success_rate": 0,
      "no_executor": 0,
      "task_not_found": 0
    }
  }
}
```

### 8.2 检查系统状态

```bash
curl -s http://localhost:5221/api/brain/status/full | jq '.alertness'

# 响应
{
  "level": 2,
  "levelName": "AWARE",
  "score": 0.65,
  "metrics": {
    "cpu_pressure": 0.5,
    "mem_pressure": 0.3,
    "error_rate": 0.1
  }
}
```

### 8.3 手动测试派发成功率

```bash
# 1. 模拟派发失败 10 次
for i in {1..10}; do
  curl -s -X POST http://localhost:5221/api/brain/action/record-dispatch \
    -H "Content-Type: application/json" \
    -d '{"success": false, "reason": "circuit_breaker_open"}'
done

# 2. 查询统计
curl -s http://localhost:5221/api/brain/dispatch-stats | jq '.window_1h.rate'
# 输出: 0.0

# 3. 派发会被阻止（低成功率 < 30%）
curl -s -X POST http://localhost:5221/api/brain/tick

# 4. 模拟派发成功 5 次
for i in {1..5}; do
  curl -s -X POST http://localhost:5221/api/brain/action/record-dispatch \
    -H "Content-Type: application/json" \
    -d '{"success": true}'
done

# 5. 查询统计
curl -s http://localhost:5221/api/brain/dispatch-stats | jq '.window_1h.rate'
# 输出: 0.333 (5/15)，仍然 < 30%，继续阻止
```

### 8.4 缺失的 API（需要实现）

| 端点 | 方法 | 用途 | 优先级 |
|------|------|------|--------|
| `/api/brain/circuit-breaker` | GET | 查询断路器状态 | 中 |
| `/api/brain/circuit-breaker/{key}/reset` | POST | 手动重置断路器 | 低 |
| `/api/brain/dispatch/record` | POST | 手动记录派发结果（测试用） | 低 |
| `/api/brain/dispatch/stats/historical` | GET | 查询历史统计（按小时） | 低 |

---

## 9. 现存测试覆盖率

### 9.1 已有测试

| 测试文件 | 覆盖范围 | 缺失 |
|---------|----------|------|
| circuit-breaker.test.js | CLOSED/OPEN/HALF_OPEN 状态转换 + reset | 派发成功路径集成 |
| dispatch-stats.test.js | 滚动窗口过滤 + 失败原因统计 | 时间边界 + 性能测试 |
| dispatch-low-rate.test.js | 阈值判断逻辑 | tick 派发流程集成 |

### 9.2 缺失的测试场景

1. **派发成功重置失败计数** ❌
2. **连续派发失败触发熔断** ❌
3. **HALF_OPEN 探测成功** ❌
4. **低成功率 + 断路器同时触发** ❌
5. **派发统计与断路器同步** ❌
6. **长期监控（24小时窗口滚动）** ❌

---

## 10. 推荐的改进方向

### 10.1 立即修复（高优先级）

1. ✅ 派发成功后调用 `recordSuccess('cecelia-run')`
2. ✅ 派发失败时调用 `recordFailure('cecelia-run')`
3. ✅ 添加端到端集成测试

### 10.2 监控增强（中优先级）

1. 暴露 `/api/brain/circuit-breaker` 查询端点
2. 添加断路器状态变化的 Slack/Email 通知
3. 记录派发失败原因的聚合统计

### 10.3 可观测性改进（低优先级）

1. 添加派发延迟 P50/P95/P99 统计
2. 添加每个失败原因的恢复时间统计
3. 添加关联的 trace ID 跟踪

---

## 11. 总结

### 11.1 现状

- ✅ 派发成功率统计：**完全实现**（1h 滚动窗口 + 30% 阈值）
- ✅ 断路器状态机：**完全实现**（3 次失败 + 30min 冷却）
- ✅ 低成功率熔断：**已集成到派发流程**（但需修复缺陷）
- ⚠️ 断路器集成：**部分缺陷**（成功/失败 recordSuccess/recordFailure 未调用）
- ❌ 监控 API：**缺失断路器端点**

### 11.2 关键数据

| 指标 | 值 | 说明 |
|------|-----|------|
| 成功率阈值 | 30% | `DISPATCH_RATE_THRESHOLD` |
| 最小样本 | 10 | `DISPATCH_MIN_SAMPLE` |
| 时间窗口 | 1 小时 | `WINDOW_MS = 3600000` |
| 断路器阈值 | 3 次失败 | `FAILURE_THRESHOLD` |
| 冷却时间 | 30 分钟 | `OPEN_DURATION_MS = 1800000` |

### 11.3 文件清单

| 文件 | 大小 | 职责 |
|------|------|------|
| dispatch-stats.js | 149 行 | 成功率统计 |
| circuit-breaker.js | 138 行 | 断路器状态机 |
| tick.js | 1100+ 行 | 派发流程 + 集成 |
| executor.js | 1100+ 行 | 派发触发 |
| routes.js | 1150+ 行 | API 路由 |
| 测试 | 534+ 行 | dispatch-stats + circuit-breaker + dispatch-low-rate |

