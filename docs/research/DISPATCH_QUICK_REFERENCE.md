# 派发监控和熔断 - 快速参考表

## 文件位置速查

### 核心实现文件

| 功能 | 文件路径 | 关键函数 | 行号 |
|------|---------|----------|------|
| **派发成功率统计** | `/brain/src/dispatch-stats.js` | `recordDispatchResult()` | 97 |
| | | `computeWindow1h()` | 65 |
| | | `getDispatchStats()` | 135 |
| **电路熔断** | `/brain/src/circuit-breaker.js` | `isAllowed()` | 48 |
| | | `recordFailure()` | 78 |
| | | `recordSuccess()` | 61 |
| **派发执行** | `/brain/src/executor.js` | `triggerCeceliaRun()` | 1051 |
| | | `checkServerResources()` | 180 |
| | | `triggerMiniMaxExecutor()` | 982 |
| **派发流程** | `/brain/src/tick.js` | `dispatchNextTask()` | 679 |

### 测试文件

| 覆盖范围 | 文件路径 |
|---------|---------|
| 成功率统计 | `/brain/src/__tests__/dispatch-stats.test.js` |
| 低成功率保护 | `/brain/src/__tests__/dispatch-low-rate.test.js` |
| 电路熔断 | `/brain/src/__tests__/circuit-breaker.test.js` |
| 派发执行失败 | `/brain/src/__tests__/dispatch-executor-fail.test.js` |

---

## 关键常数

### dispatch-stats.js

```javascript
DISPATCH_STATS_KEY = 'dispatch_stats'        // DB key
WINDOW_MS = 3,600,000                        // 1 小时
DISPATCH_RATE_THRESHOLD = 0.3                // 30% 阈值
DISPATCH_MIN_SAMPLE = 10                     // 最少样本
```

### circuit-breaker.js

```javascript
FAILURE_THRESHOLD = 3                        // 连续失败次数
OPEN_DURATION_MS = 1,800,000                 // 30 分钟冷却
```

### executor.js

```javascript
HK_MINIMAX_URL = 'http://100.86.118.99:5226' // HK 执行器
MEM_PER_TASK_MB = 500                         // 每任务内存
CPU_PER_TASK = 0.5                            // 每任务 CPU
INTERACTIVE_RESERVE = 2                       // 预留座位
```

---

## 派发失败原因码

| 原因码 | 触发条件 | 恢复时间 |
|--------|---------|---------|
| `draining` | 系统排水模式 | 手动恢复 |
| `billing_pause` | 计费上限 | 自动或手动重置 |
| `user_team_mode` | 用户团队模式 | 用户切换模式 |
| `pool_exhausted` | 资源池耗尽 | 自动补充 |
| `pool_c_full` | C 类资源满 | 自动释放 |
| `circuit_breaker_open` | 连续失败 3 次 | 30 分钟或成功 |
| `pre_flight_check_failed` | 任务质量差 | 自动修复或隔离 |
| `no_executor` | 执行器不可用 | 执行器恢复 |
| `task_not_found` | 任务丢失 | 数据库恢复 |
| `executor_failed` | 执行器错误 | 自动重试或隔离 |
| `low_success_rate` | 成功率 < 30% | 系统恢复或手动干预 |

---

## 派发成功率监控流程

```
┌─ recordDispatchResult(pool, success, reason)
│  ├─ 读取现有 dispatch_stats
│  ├─ 追加新事件 { ts, success, reason? }
│  ├─ 裁剪过期事件（> 1 小时）
│  ├─ 计算 computeWindow1h()
│  │  ├─ 过滤窗口内事件
│  │  ├─ 计算 rate = success / total
│  │  └─ 统计 failure_reasons
│  └─ 写入 working_memory
│
└─ getDispatchStats(pool, nowMs)
   ├─ 读取现有 dispatch_stats
   ├─ 重新计算 computeWindow1h()
   └─ 返回 { window_1h: {...} }
```

---

## 电路熔断状态转移

```
初始状态：CLOSED (failures=0)
  ↓
  ├─ recordSuccess() → 重置为 CLOSED (failures=0)
  │
  └─ recordFailure()
     ├─ failures++
     ├─ 若 failures >= 3 → OPEN (openedAt=now)
     │                   → 发出 circuit_open 事件
     │
     └─ 若已是 OPEN & 等待 30 分钟
        → 自动转到 HALF_OPEN
           ├─ recordSuccess() → CLOSED
           └─ recordFailure() → 回到 OPEN
```

---

## 派发检查链（tick.js 第 679-891 行）

```
dispatchNextTask()
│
├─ [0] 排水模式检查
│  ├─ _draining === true
│  └─ getMitigationState().drain_mode_requested === true
│  → return { reason: 'draining' }
│
├─ [0a] 计费暂停检查
│  └─ getBillingPause().active === true
│  → return { reason: 'billing_pause' }
│
├─ [0b] 资源池预算检查
│  └─ calculateSlotBudget().dispatchAllowed === false
│  → return { reason: 'pool_exhausted|pool_c_full|user_team_mode' }
│
├─ [2] 电路熔断检查
│  └─ !isAllowed('cecelia-run')
│  → return { reason: 'circuit_breaker_open' }
│
├─ [3] 任务选择 + 预检查（最多 5 次重试）
│  └─ selectNextDispatchableTask()
│  └─ preFlightCheck()
│  → return { reason: 'pre_flight_check_failed' }
│
├─ [6] 更新任务状态为 in_progress
│  └─ updateTask({ status: 'in_progress' })
│
├─ [5] 执行器可用性检查
│  └─ checkCeceliaRunAvailable()
│  → return { reason: 'no_executor' }
│
├─ [7] 执行派发
│  └─ triggerCeceliaRun(task)
│  ├─ 重复检查：已在运行？
│  ├─ 资源检查：CPU/MEM/SWAP？
│  ├─ HTTP 派发到 cecelia-bridge 或 HK MiniMax
│  └─ 失败时回滚 status 到 queued
│  → return { reason: 'executor_failed|already_running|server_overloaded' }
│
└─ [8] 派发成功
   └─ recordDispatchResult(pool, true)
   → return { dispatched: true, task_id, run_id }
```

---

## 数据库查询

### 查看派发统计

```bash
# 获取 dispatch_stats
psql -d cecelia << SQL
SELECT value_json FROM working_memory WHERE key = 'dispatch_stats';
SQL

# 或通过 API
curl -s http://localhost:5221/api/brain/memory | jq '.[] | select(.key == "dispatch_stats")'
```

### 查看派发历史

```bash
# 查看最近 10 次派发事件
psql -d cecelia << SQL
SELECT 
  value_json->'events'->-1 as latest_event,
  value_json->'window_1h' as stats
FROM working_memory 
WHERE key = 'dispatch_stats';
SQL
```

---

## 熔断器状态查询

```bash
# 通过状态 API
curl -s http://localhost:5221/api/brain/status/full | jq '.working_memory | .[] | select(.key == "circuit_breaker")'

# 或查看完整状态
curl -s http://localhost:5221/api/brain/health | jq '.breakers'
```

---

## 常见排查步骤

### 问题：派发成功率突然下降

1. **查看最近 1 小时的失败原因**
   ```bash
   curl -s http://localhost:5221/api/brain/memory | jq '.[] | select(.key == "dispatch_stats") | .value_json.window_1h.failure_reasons'
   ```

2. **最常见的失败原因**
   - `circuit_breaker_open`：检查执行器健康状态
   - `pool_exhausted`：增加资源池配额
   - `executor_failed`：检查 cecelia-run 或 HK MiniMax
   - `pre_flight_check_failed`：检查任务队列质量

3. **重置熔断器（如果卡在 OPEN）**
   ```bash
   curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset
   ```

### 问题：系统进入排水模式

```bash
# 查看排水状态
curl -s http://localhost:5221/api/brain/memory | jq '.[] | select(.key == "drain")'

# 恢复派发
curl -X POST http://localhost:5221/api/brain/drain/off
```

### 问题：成功率为 null

- 表示系统刚启动，还没有派发数据
- 需要等待 10+ 次派发后才能计算成功率

---

## 性能指标

| 指标 | 值 | 说明 |
|------|-----|------|
| 窗口大小 | 1 小时 | 越短越敏感，越长越稳定 |
| 最小样本 | 10 | 防止小样本波动 |
| 成功率阈值 | 30% | 严格保护，< 30% 视为系统故障 |
| 电路冷却 | 30 分钟 | 给系统充足恢复时间 |

---

## 推荐配置变更场景

| 场景 | 参数 | 建议值 | 原因 |
|------|------|--------|------|
| 系统不稳定 | `DISPATCH_RATE_THRESHOLD` | 0.5 (50%) | 更早发现问题 |
| 系统很稳定 | `DISPATCH_RATE_THRESHOLD` | 0.2 (20%) | 减少误触发 |
| 快速恢复需求 | `OPEN_DURATION_MS` | 10 分钟 | 更快尝试恢复 |
| 保守恢复 | `OPEN_DURATION_MS` | 60 分钟 | 更安全但更慢 |
| 高频派发 | `DISPATCH_MIN_SAMPLE` | 20 | 更多样本=更准确 |

---

## 事件 emit 清单

| 事件 | 来源 | 发送条件 |
|------|------|---------|
| `circuit_open` | circuit-breaker.js | 失败阈值达到或探测失败 |
| `circuit_closed` | circuit-breaker.js | HALF_OPEN 状态成功恢复 |
| `task_dispatched` | tick.js | 派发成功 |

---

## 测试运行

```bash
# 运行派发统计测试
npm test -- dispatch-stats.test.js

# 运行低成功率测试
npm test -- dispatch-low-rate.test.js

# 运行电路熔断测试
npm test -- circuit-breaker.test.js

# 运行所有派发相关测试
npm test -- dispatch
```

