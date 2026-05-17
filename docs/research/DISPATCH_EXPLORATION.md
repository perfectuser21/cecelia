# Cecelia Core - 任务派发成功率监控和熔断机制探索报告

## 执行摘要

Cecelia Core 仓库中包含了完整的任务派发成功率监控和熔断保护系统。该系统采用**多层保护机制**，包括：

1. **派发成功率统计**（dispatch-stats）- 1 小时滚动窗口监控
2. **电路熔断器**（circuit-breaker）- 三态熔断保护
3. **派发前验证**（pre-flight-check）- 任务质量检查
4. **资源检查**（executor）- 服务器资源保护
5. **告警系统**（alertness）- 多级告警应对

---

## 1. 派发成功率统计 (dispatch-stats.js)

### 文件路径
```
/home/xx/perfect21/cecelia/core/brain/src/dispatch-stats.js
```

### 核心数据结构
```javascript
// 存储在 PostgreSQL working_memory 表，key = 'dispatch_stats'
{
  window_1h: {
    total: number,           // 1 小时内总派发次数
    success: number,         // 成功次数
    failed: number,          // 失败次数
    rate: number|null,       // 成功率 (0-1)，null 表示无数据
    last_updated: string,    // ISO 时间戳
    failure_reasons: {       // 失败原因统计
      [reason]: number
    }
  },
  events: [
    { ts: string, success: boolean, reason?: string }
  ]
}
```

### 关键常数（事实来源）

| 常数 | 值 | 说明 | 行号 |
|------|-----|------|------|
| `DISPATCH_STATS_KEY` | `'dispatch_stats'` | DB 存储 key | 22 |
| `WINDOW_MS` | `60 * 60 * 1000` (3600s) | 1 小时滚动窗口 | 23 |
| `DISPATCH_RATE_THRESHOLD` | `0.3` | 成功率阈值 (30%) | 24 |
| `DISPATCH_MIN_SAMPLE` | `10` | 最小样本数 | 25 |

### 关键函数

#### 1. `computeWindow1h(events, now)`（纯函数，第 65-88 行）
```javascript
/**
 * 计算 1 小时窗口内的统计
 * @param {Array} events - 事件数组 [{ ts, success, reason? }]
 * @param {number} now - 当前时间戳（ms）
 * @returns {Object} - { total, success, failed, rate, failure_reasons }
 */
```

**功能**：
- 过滤 1 小时内的事件
- 计算成功率 (success_count / total_count)
- 统计各类失败原因的出现次数

**重要特性**：
- 窗口边界判断：`cutoff = now - WINDOW_MS`，事件时间 >= cutoff 才计入
- 无数据时返回 `rate: null`

#### 2. `recordDispatchResult(pool, success, reason = null, nowMs)`（第 97-128 行）
```javascript
/**
 * 记录一次派发结果到 dispatch_stats（纯监控，不影响派发逻辑）
 * @param {object} pool - pg 连接池
 * @param {boolean} success - 是否成功派发
 * @param {string|null} reason - 失败原因
 * @param {number} [nowMs] - 当前时间戳（可注入，便于测试）
 */
```

**功能**：
- 追加新事件到 events 数组
- 裁剪过期事件（只保留 1 小时内的）
- 重新计算 window_1h 统计
- 写回 DB

**错误处理**：
- DB 错误会被静默吞掉（console.error），不影响派发流程

#### 3. `readDispatchStats(pool)`（第 31-45 行）
```javascript
// 从 working_memory 读取 dispatch_stats，无数据返回 { events: [] }
```

#### 4. `writeDispatchStats(pool, data)`（第 52-58 行）
```javascript
// 写入 dispatch_stats 到 working_memory（UPSERT）
```

#### 5. `getDispatchStats(pool, nowMs)`（第 135-146 行）
```javascript
// 获取当前 dispatch_stats，用于 API 返回（重新计算使用最新时间）
```

### 失败原因列表（来自 tick.js）

从 tick.js 的 `recordDispatchResult` 调用，可得出以下失败原因：

| 原因 | 行号 | 触发条件 |
|------|------|----------|
| `draining` | 688 | 系统处于排水模式 |
| `billing_pause` | 700 | API 计费上限激活 |
| `user_team_mode` | 708 | 用户处于团队模式 |
| `pool_exhausted` | 709 | 任务池预算耗尽 |
| `pool_c_full` | 709 | C 类资源池满 |
| `circuit_breaker_open` | 720 | 熔断器打开 |
| `pre_flight_check_failed` | 761 | 任务质量检查失败 |
| `no_executor` | 797 | 执行器不可用 |
| `task_not_found` | 803 | 任务记录丢失 |
| `executor_failed` | 820 | 执行器派发失败 |
| (无) | 888 | 派发成功 |

### 测试覆盖
文件：`/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-stats.test.js`
- 纯函数测试 `computeWindow1h`（无需 mock）
- DB 操作测试 `recordDispatchResult`（mock pool）
- 滚动窗口边界测试
- 多种失败原因统计测试
- DB 错误容错测试

---

## 2. 电路熔断器 (circuit-breaker.js)

### 文件路径
```
/home/xx/perfect21/cecelia/core/brain/src/circuit-breaker.js
```

### 熔断状态机

```
CLOSED (正常) 
  → 失败 3 次
  → OPEN (阻断)
     → 等待 30 分钟
     → HALF_OPEN (探测)
        → 成功 → CLOSED
        → 失败 → OPEN
```

### 核心常数

| 常数 | 值 | 行号 |
|------|-----|------|
| `FAILURE_THRESHOLD` | `3` | 14 |
| `OPEN_DURATION_MS` | `30 * 60 * 1000` (1800s) | 15 |

### 状态数据结构
```javascript
{
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',  // 当前状态
  failures: number,                         // 连续失败次数
  lastFailureAt: number | null,            // 最后失败时间戳
  openedAt: number | null                  // 打开时间戳
}
```

### 关键函数

#### 1. `getState(key = 'default')`（第 29-41 行）
- 获取指定 worker key 的熔断状态
- **自动转移**：OPEN 时间 > 30 分钟 → HALF_OPEN

#### 2. `isAllowed(key = 'default')`（第 48-54 行）
- 检查派发是否被允许
- 逻辑：`state !== 'OPEN'` → 允许（CLOSED 或 HALF_OPEN）

#### 3. `recordSuccess(key = 'default')`（第 61-72 行）
- 记录成功：重置为 CLOSED
- 如果之前是 HALF_OPEN，发出 `circuit_closed` 事件

#### 4. `recordFailure(key = 'default')`（第 78-106 行）
- 记录失败：增加 failures 计数
- 如果 HALF_OPEN → OPEN（探测失败，重新阻断）
- 如果 CLOSED & failures >= 3 → OPEN（阈值触发）
- 发出 `circuit_open` 事件并通知（notifyCircuitOpen）

#### 5. `reset(key = 'default')`（第 112-114 行）
- 强制重置为 CLOSED（管理员恢复用）

#### 6. `getAllStates()`（第 120-126 行）
- 返回所有 worker 的熔断状态（用于 API）

### 内存存储
```javascript
const breakers = new Map();  // 第 18 行
// Key: worker identifier (如 'cecelia-run')
// Value: 状态对象
```

### 集成点（tick.js）

- **导入**：第 14 行
- **使用**：`isAllowed('cecelia-run')`（第 719 行）
  ```javascript
  if (!isAllowed('cecelia-run')) {
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }
  ```

### 测试覆盖
文件：`/home/xx/perfect21/cecelia/core/brain/src/__tests__/circuit-breaker.test.js`

---

## 3. 派发执行流程 (executor.js)

### 文件路径
```
/home/xx/perfect21/cecelia/core/brain/src/executor.js
```

### 关键派发函数

#### 1. `triggerCeceliaRun(task)`（第 1051-1211 行）

**功能流程**：
1. 路由判断（第 1053-1055 行）：
   - 如果 task_type 在 HK 映射中，调用 `triggerMiniMaxExecutor`
   - 否则调用本地 cecelia-bridge (port 3457)

2. 生成 run_id（第 1061 行）
   ```javascript
   const runId = generateRunId(task.id);
   ```

3. 创建跟踪步骤（第 1064-1076 行）：
   - 记录 taskId, runId, 执行代理类型等
   - layer = `LAYER.L0_ORCHESTRATOR`

4. **重复派发检查**（第 1082-1101 行）：
   ```javascript
   const existing = activeProcesses.get(task.id);
   if (existing && isProcessAlive(existing.pid)) {
     return { success: false, reason: 'already_running', ... };
   }
   ```

5. **资源检查**（第 1103-1118 行）：
   ```javascript
   const resources = checkServerResources();
   if (!resources.ok) {
     return { success: false, reason: 'server_overloaded', ... };
   }
   ```

6. **HTTP 派发**（第 1141-1153 行）：
   - 调用 cecelia-bridge: `POST /trigger-cecelia`
   - 传递 task_id, checkpoint_id, prompt, task_type, permission_mode, repo_path, model

7. **跟踪完成**（第 1179-1185 行）：
   - 成功：记录 checkpoint_id, log_file
   - 失败：记录错误

**返回值**：
```javascript
{
  success: boolean,
  taskId: string,
  runId: string,
  checkpointId?: string,
  logFile?: string,
  reason?: string,  // 失败原因
  error?: string    // 错误信息
}
```

#### 2. `triggerMiniMaxExecutor(task)`（第 982-1040 行）

**功能流程**：
1. 调用 HK MiniMax 执行器（第 988-998 行）：
   - URL: `${HK_MINIMAX_URL}/execute`（默认：http://100.86.118.99:5226）
   - 超时：2 分钟

2. 更新任务状态为 completed（第 1006-1012 行）

**返回值**：
```javascript
{
  success: boolean,
  taskId: string,
  runId: string,
  result?: any,           // 执行结果
  usage?: object,         // 使用统计
  error?: string,
  executor: 'minimax'
}
```

### 资源检查函数

#### `checkServerResources()`（第 180-256 行）

**检查项**：
1. **CPU 负载**：
   - 公式：`Math.min(load[0], load[1], load[2]) >= LOAD_THRESHOLD`
   - LOAD_THRESHOLD 基于 CPU 核心数计算
   - 预留 2 个 interactive slot

2. **内存**：
   - 最低可用内存：`TOTAL_MEM_MB * 0.15 + RESERVE_MEM_MB`
   - 当前 active processes 消耗估算

3. **Swap 使用率**：
   - 硬停止条件：swap > 70%

**返回**：
```javascript
{
  ok: boolean,
  reason?: string,
  metrics?: {
    cpu_load: number,
    load_threshold: number,
    available_mem_mb: number,
    swap_pct: number,
    active_processes: number
  }
}
```

### 常数配置

| 常数 | 值 | 说明 | 行号 |
|------|-----|------|------|
| `HK_MINIMAX_URL` | `http://100.86.118.99:5226` | HK MiniMax 执行器 URL | 29 |
| `CECELIA_RUN_PATH` | `/home/xx/bin/cecelia-run` | cecelia-run 二进制路径 | 32 |
| `MEM_PER_TASK_MB` | `500` | 每个 claude 进程平均内存 | 129 |
| `CPU_PER_TASK` | `0.5` | 每个 claude 进程平均 CPU | 130 |
| `INTERACTIVE_RESERVE` | `2` | 为交互式会话保留的座位 | 131 |
| `MAX_SEATS` | 动态计算 | 最大并发任务数 | 136 |

---

## 4. 派发流程集成 (tick.js)

### 文件路径
```
/home/xx/perfect21/cecelia/core/brain/src/tick.js
```

### 派发函数
#### `dispatchNextTask(goalIds)`（第 679-891 行）

**完整派发检查流程**：

```
1. 排水模式检查 (line 687-695)
   └─ recordDispatchResult(false, 'draining')

2. 计费暂停检查 (line 698-702)
   └─ recordDispatchResult(false, 'billing_pause')

3. 资源池预算检查 (line 705-716)
   └─ calculateSlotBudget() → recordDispatchResult(false, slotReason)

4. 熔断器检查 (line 719-722)
   └─ isAllowed('cecelia-run') → recordDispatchResult(false, 'circuit_breaker_open')

5. 任务选择 + 预检查 (line 724-767)
   └─ preFlightCheck() → recordDispatchResult(false, 'pre_flight_check_failed')
   └─ 最多重试 5 个任务

6. 任务状态更新 (line 770-777)
   └─ updateTask({ status: 'in_progress' })

7. 执行器可用性检查 (line 787-798)
   └─ checkCeceliaRunAvailable() → recordDispatchResult(false, 'no_executor')

8. 执行派发 (line 807-822)
   └─ triggerCeceliaRun(task) → recordDispatchResult(success/failure)
   └─ 失败时回滚任务状态到 queued
   └─ recordFailure('cecelia-run') [circuit-breaker]

9. 派发统计记录 (line 888)
   └─ recordDispatchResult(true) [成功]
```

### 派发成功率监控集成

```javascript
// 第 21 行
import { recordDispatchResult, getDispatchStats } from './dispatch-stats.js';

// 各个检查点调用 recordDispatchResult：
await recordDispatchResult(pool, success, reason);
```

**导入的函数**：
- `recordDispatchResult(pool, success, reason = null, nowMs)`
- `getDispatchStats(pool, nowMs)` - 用于查询当前统计

---

## 5. 派发成功率低保护机制

### 当前状态

从测试文件可见，已有**完整的低成功率保护设计**（dispatch-low-rate.test.js），但：

**待实现的检查点**：
1. 在 tick.js 的派发流程中（0b 阶段，circuit breaker 和 slot budget 之间）
2. 检查条件：
   ```
   rate !== null && 
   total >= DISPATCH_MIN_SAMPLE (10) &&
   rate < DISPATCH_RATE_THRESHOLD (0.3)
   ```
3. 若触发，应：
   ```javascript
   await recordDispatchResult(pool, false, 'low_success_rate');
   return { dispatched: false, reason: 'low_success_rate', ... };
   ```

### 测试文件
```
/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-low-rate.test.js
```

**测试场景**：
- 成功率 20% (< 30%) + 样本 15 个 → 应触发熔断 ✅
- 成功率 30% (= 阈值) → 不触发 ✅
- 样本不足 (9 个 < 10) → 不触发，即使 0% ✅
- 无数据 → 不触发 ✅
- 1 小时窗口边界：过期数据不计入 ✅

---

## 6. 现有的熔断机制总结

| 熔断机制 | 位置 | 触发条件 | 恢复时间 | 状态 |
|---------|------|---------|---------|------|
| 电路熔断 | circuit-breaker.js | 连续 3 次失败 | 30 分钟 | **实现完成** ✅ |
| 派发成功率 | dispatch-stats.js | rate < 30%, sample >= 10 | 系统自动（新数据覆盖） | **设计完成，检查点待实现** ⚙️ |
| 资源饱和 | executor.js | CPU/MEM/SWAP 超限 | 系统自动恢复 | **实现完成** ✅ |
| 排水模式 | tick.js | 手动激活或 alertness 请求 | 手动恢复或告警恢复 | **实现完成** ✅ |
| 资源池预算 | slot-allocator.js | 资源池余额为 0 | 自动补充（周期性） | **实现完成** ✅ |

---

## 7. 关键文件速查表

### 派发相关文件

| 文件 | 行数 | 主要功能 |
|------|------|---------|
| `/home/xx/perfect21/cecelia/core/brain/src/dispatch-stats.js` | 147 | 成功率统计、1 小时滚动窗口、失败原因分类 |
| `/home/xx/perfect21/cecelia/core/brain/src/circuit-breaker.js` | 138 | 三态熔断（CLOSED/OPEN/HALF_OPEN）、30 分钟冷却 |
| `/home/xx/perfect21/cecelia/core/brain/src/executor.js` | 1571 | 派发执行、资源检查、HK MiniMax 路由 |
| `/home/xx/perfect21/cecelia/core/brain/src/tick.js` | 59 | 派发主循环、多层检查、事件记录 |
| `/home/xx/perfect21/cecelia/core/brain/src/pre-flight-check.js` | - | 派发前任务质量验证 |
| `/home/xx/perfect21/cecelia/core/brain/src/slot-allocator.js` | - | 多资源池预算管理 |

### 测试文件

| 文件 | 覆盖内容 |
|------|---------|
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-stats.test.js` | 成功率统计、窗口边界、失败原因统计、DB 操作 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-low-rate.test.js` | 低成功率熔断阈值判断 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/circuit-breaker.test.js` | 三态转移、冷却恢复、探测机制 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-executor-fail.test.js` | 派发执行失败场景 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/dispatch-preflight-skip.test.js` | 预检查失败重试 |

---

## 8. 数据库存储

### working_memory 表
```sql
-- 存储派发统计
SELECT * FROM working_memory WHERE key = 'dispatch_stats';

-- 示例输出：
{
  "window_1h": {
    "total": 42,
    "success": 40,
    "failed": 2,
    "rate": 0.9523,
    "last_updated": "2026-02-19T10:30:00Z",
    "failure_reasons": {
      "circuit_breaker_open": 1,
      "pre_flight_check_failed": 1
    }
  },
  "events": [
    { "ts": "2026-02-19T10:30:00Z", "success": true },
    { "ts": "2026-02-19T10:29:55Z", "success": false, "reason": "circuit_breaker_open" },
    ...
  ]
}
```

---

## 9. API 查询方式

### 获取派发统计
```bash
curl -s http://localhost:5221/api/brain/status/full | jq '.working_memory | select(.key == "dispatch_stats") | .value_json'

# 或直接访问 memory API
curl -s http://localhost:5221/api/brain/memory | jq '.[] | select(.key == "dispatch_stats")'
```

### 获取熔断状态
```bash
# 在状态 API 中查看
curl -s http://localhost:5221/api/brain/status/full | jq '.working_memory'
```

---

## 10. 关键设计决策

1. **1 小时滚动窗口**：避免长期历史数据影响，快速响应最近趋势
2. **最小样本 10**：防止小样本偏差导致误触发
3. **30% 成功率阈值**：严格保护，低于此值认为系统有严重问题
4. **30 分钟熔断冷却**：给系统足够时间恢复
5. **HALF_OPEN 探测**：恢复前先试探一个任务，避免立即 crash
6. **独立记录机制**：dispatch_stats 完全独立，DB 错误不影响派发主流程
7. **多层检查**：circuit-breaker + dispatch-stats + 资源检查 + 预检查，纵深防御

---

## 总结

Cecelia Core 的派发监控系统是**多层纵深防御**架构：

```
派发请求
  ├─ 排水模式检查
  ├─ 计费检查
  ├─ 资源池预算检查
  ├─ 电路熔断检查  ← circuit-breaker.js
  ├─ 低成功率检查  ← dispatch-stats.js（设计完成，实现待补）
  ├─ 任务预检查
  ├─ 执行器可用性检查
  ├─ 资源检查  ← executor.js
  └─ HTTP 派发
```

所有关键数据都在代码中（**事实来源**），文档应同步更新以保持一致。
