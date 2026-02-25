# 派发成功率监控与熔断 - 快速参考表

## 核心文件与函数

### 派发成功率统计 (dispatch-stats.js)

| 函数 | 签名 | 用途 | 所在行 |
|------|------|------|--------|
| `computeWindow1h` | `(events, now) → {total, success, failed, rate, failure_reasons}` | 纯函数：计算 1h 窗口统计 | 67 |
| `recordDispatchResult` | `(pool, success, reason?, nowMs?)` | 异步记录派发结果到 DB | 99 |
| `getDispatchStats` | `(pool, nowMs?)` → `{window_1h}` | 异步读取当前统计 | 137 |
| `readDispatchStats` | `(pool)` → `{events, window_1h?}` | 读取原始数据 | 33 |
| `writeDispatchStats` | `(pool, data)` | 写入原始数据 | 54 |

**关键常量**：
```javascript
DISPATCH_RATE_THRESHOLD = 0.3      // 成功率阈值 30%
DISPATCH_MIN_SAMPLE = 10           // 最小样本数
WINDOW_MS = 3600000                // 1 小时窗口
```

### 断路器 (circuit-breaker.js)

| 函数 | 签名 | 用途 | 所在行 |
|------|------|------|--------|
| `getState` | `(key='default') → breaker_state` | 获取状态（自动 OPEN→HALF_OPEN 转换） | 29 |
| `isAllowed` | `(key='default') → boolean` | 判断是否允许派发 | 48 |
| `recordSuccess` | `(key='default')` | 记录成功，重置为 CLOSED | 61 |
| `recordFailure` | `(key='default')` | 记录失败，累加计数 | 78 |
| `reset` | `(key='default')` | 强制重置 | 112 |
| `getAllStates` | `() → {[key]: state}` | 获取所有 worker 状态 | 120 |

**关键常量**：
```javascript
FAILURE_THRESHOLD = 3              // 触发 OPEN 的失败次数
OPEN_DURATION_MS = 1800000         // OPEN→HALF_OPEN 转换时间 (30min)
```

---

## 派发流程集成

### dispatchNextTask() 检查顺序 (tick.js:601-802)

| 序号 | 检查 | 失败原因 | 记录方式 | 行号 |
|------|------|--------|--------|------|
| 0a | 排水模式 | `draining` | `recordDispatchResult(false, 'draining')` | 610 |
| 0b | 账单暂停 | `billing_pause` | `recordDispatchResult(false, 'billing_pause')` | 622 |
| **0c** | **低成功率** | **`low_success_rate`** | **`recordDispatchResult(false, 'low_success_rate')`** | **632** |
| 1 | 资源预算 | `pool_exhausted` / `pool_c_full` | `recordDispatchResult(false, slotReason)` | 649 |
| **2** | **断路器** | **`circuit_breaker_open`** | **`recordDispatchResult(false, 'circuit_breaker_open')`** | **660** |
| 3 | 任务筛选 | `no_dispatchable_task` | (返回) | 667 |
| 3a | 飞行前检查 | `pre_flight_check_failed` | `recordDispatchResult(false, ...)` | 691 |
| 4 | 状态更新 | (内部失败) | (返回) | 702 |
| 5 | Executor 可用 | `no_executor` | `recordDispatchResult(false, 'no_executor')` | 723 |
| 5a | 任务查询 | `task_not_found` | `recordDispatchResult(false, 'task_not_found')` | 729 |
| **6** | **触发派发** | (派发失败) | **❌ 缺 recordFailure()** | **733** |
| **7** | **记录成功** | (派发成功) | **recordDispatchResult(true)** | **799** |
| 7 | | | **❌ 缺 recordSuccess()** | |

---

## 状态转换规则

### 低成功率熔断 (dispatch-stats)

```
条件：rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD

判断表：
┌──────────┬────────┬────────────────┐
│  成功率  │ 样本数 │   是否阻止派发   │
├──────────┼────────┼────────────────┤
│  20%     │   15   │  ✅ 是 (20<30)   │
│  30%     │   10   │  ❌ 否 (=30)     │
│  31%     │   10   │  ❌ 否 (>30)     │
│  20%     │    9   │  ❌ 否 (样本<10) │
│  null    │    0   │  ❌ 否 (无数据)  │
```

### 断路器状态机 (circuit-breaker)

```
                      CLOSED (正常)
                      ↓ (失败 >= 3 次)
                      OPEN (阻止, 30min)
                      ↓ (30min 后自动)
                      HALF_OPEN (探测)
                    ↙      ↘
              成功 /        \ 失败
              CLOSED        OPEN
```

**注**：CLOSED 到 OPEN 需要 3 次**连续**失败。成功会重置计数（但当前代码缺少 `recordSuccess()` 调用）。

---

## 现有缺陷

### 缺陷 #1: recordSuccess 未调用 (HIGH)

**位置**: tick.js:799

**问题**:
```javascript
// ❌ 当前（缺陷）
await recordDispatchResult(pool, true);

// ✅ 应该加上
await recordSuccess('cecelia-run');  // 重置断路器失败计数
```

**影响**: 派发成功后断路器失败计数不重置，导致误触发

---

### 缺陷 #2: 派发失败未记录 (HIGH)

**位置**: tick.js:733-755

**问题**:
```javascript
const execResult = await triggerCeceliaRun(task);
// ❌ 缺少：
// if (!execResult.success) {
//   await recordFailure('cecelia-run');
// }
```

**影响**: 派发失败不累加断路器计数，断路器永不打开

---

### 缺陷 #3: 低成功率自引用 (MEDIUM)

**位置**: dispatch-stats.js:70-89 & tick.js:632

**问题**: 低成功率阻止派发时，`recordDispatchResult(false, 'low_success_rate')` 被计入 `failure_reasons['low_success_rate']`，虽然派发本身未尝试

**是否修复**: 建议区分"派发阻止"vs"派发失败"，但当前逻辑可接受

---

### 缺陷 #4: 未测试派发成功路径 (MEDIUM)

**位置**: 测试文件缺失

**问题**: 没有端到端测试验证派发成功→recordSuccess→失败计数重置

**缺失测试**:
- `circuit-breaker-success.test.js` 需要创建
- 需要测试：派发失败 3 次 → OPEN → HALF_OPEN 探测成功 → CLOSED

---

## API 端点

### 派发统计 (GET)

```bash
curl http://localhost:5221/api/brain/dispatch-stats

响应：
{
  "window_1h": {
    "total": 42,
    "success": 35,
    "failed": 7,
    "rate": 0.833,
    "last_updated": "2026-02-18T15:30:00Z",
    "failure_reasons": {
      "circuit_breaker_open": 3,
      "pool_exhausted": 2,
      "low_success_rate": 0,  // 派发阻止计数
      ...
    }
  }
}
```

**位置**: routes.js:1105-1112

---

### 断路器状态查询 (缺失)

目前无专门 API，状态存在内存。需要创建：

```bash
GET /api/brain/circuit-breaker

响应：
{
  "cecelia-run": {
    "state": "CLOSED|OPEN|HALF_OPEN",
    "failures": 0,
    "lastFailureAt": null,
    "openedAt": null
  }
}
```

---

## 监控检查清单

- [ ] 成功率是否 < 30%？ → `GET /api/brain/dispatch-stats`
- [ ] 样本数是否 >= 10？ → 同上，检查 `total` 字段
- [ ] 派发是否被阻止？ → 查看日志 `[dispatch] 低成功率熔断`
- [ ] 断路器状态？ → 需要添加 API 端点（当前缺失）
- [ ] 派发失败原因分布？ → `failure_reasons` 对象

---

## 触发流程

### 低成功率熔断触发

1. **条件达成**: rate < 30% && total >= 10
2. **触发位置**: tick.js:631-642
3. **日志输出**: `[dispatch] 低成功率熔断: rate=XX% total=XX threshold=30%`
4. **记录结果**: dispatch_stats.failure_reasons['low_success_rate']++
5. **事件发送**: `dispatch_low_success_rate` 事件
6. **恢复方式**: 等待 1h 窗口滚动或派发成功

### 断路器熔断触发

1. **条件达成**: 3 次连续派发失败（**但当前缺 recordFailure() 调用**）
2. **触发位置**: circuit-breaker.js:96-104
3. **日志输出**: `[circuit-breaker] OPEN: failure_threshold_reached`
4. **记录结果**: state='OPEN', openedAt=now
5. **事件发送**: `circuit_open` 事件
6. **恢复时间**: 30 分钟后自动转为 HALF_OPEN，允许 1 个探测

---

## 数据流向

```
派发触发
  ↓
低成功率检查
  ├─ 读：getDispatchStats()
  └─ 写：recordDispatchResult(false, 'low_success_rate')
  ↓
断路器检查
  └─ 读：isAllowed('cecelia-run')
  ↓
执行派发
  ├─ 成功: recordDispatchResult(true) + recordSuccess('cecelia-run') ❌缺
  └─ 失败: recordDispatchResult(false) + recordFailure('cecelia-run') ❌缺
  ↓
统计更新
  └─ dispatch_stats.window_1h 自动重新计算
```

---

## 文件清单

| 文件 | 行数 | 用途 | 状态 |
|------|------|------|------|
| dispatch-stats.js | 149 | 成功率统计 | ✅ 完整 |
| circuit-breaker.js | 138 | 断路器状态机 | ✅ 完整 |
| tick.js | 1100+ | 派发流程 + 集成 | ⚠️ 缺陷 |
| executor.js | 1100+ | 派发触发 | ✅ 完整 |
| routes.js | 1150+ | API 路由 | ✅ 部分 |
| __tests__/circuit-breaker.test.js | 171 | 断路器测试 | ✅ 完整 |
| __tests__/dispatch-stats.test.js | 245 | 统计测试 | ✅ 完整 |
| __tests__/dispatch-low-rate.test.js | 118 | 低成功率测试 | ✅ 完整 |

---

## 推荐修复顺序

1. **第 1 优先级** (立即修复)
   - [ ] tick.js:733 派发失败时添加 `recordFailure('cecelia-run')`
   - [ ] tick.js:799 派发成功时添加 `recordSuccess('cecelia-run')`

2. **第 2 优先级** (完善测试)
   - [ ] 创建 circuit-breaker-success.test.js 端到端测试
   - [ ] 添加低成功率 + 断路器同时触发的集成测试

3. **第 3 优先级** (监控增强)
   - [ ] 添加 `/api/brain/circuit-breaker` 查询端点
   - [ ] 添加断路器状态变化通知

---

## 生成时间

2026-02-18
