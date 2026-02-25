# 派发监控和熔断 - 代码片段速查

## 1. 派发成功率统计核心代码

### dispatch-stats.js 第 65-88 行：computeWindow1h()
```javascript
export function computeWindow1h(events, now) {
  const cutoff = now - WINDOW_MS;
  const recent = events.filter(e => new Date(e.ts).getTime() >= cutoff);

  const total = recent.length;
  const success = recent.filter(e => e.success).length;
  const failed = total - success;
  const rate = total > 0 ? success / total : null;

  const failure_reasons = {};
  for (const e of recent) {
    if (!e.success && e.reason) {
      failure_reasons[e.reason] = (failure_reasons[e.reason] || 0) + 1;
    }
  }

  return { total, success, failed, rate, failure_reasons };
}
```

### dispatch-stats.js 第 97-128 行：recordDispatchResult()
```javascript
export async function recordDispatchResult(pool, success, reason = null, nowMs) {
  const now = nowMs !== undefined ? nowMs : Date.now();
  const ts = new Date(now).toISOString();

  try {
    const data = await readDispatchStats(pool);
    
    const event = { ts, success };
    if (!success && reason) {
      event.reason = reason;
    }
    data.events.push(event);

    // 裁剪：只保留 1 小时内的事件
    const cutoff = now - WINDOW_MS;
    data.events = data.events.filter(e => new Date(e.ts).getTime() >= cutoff);

    // 重新计算窗口统计
    data.window_1h = {
      ...computeWindow1h(data.events, now),
      last_updated: ts
    };

    await writeDispatchStats(pool, data);
  } catch (err) {
    // 统计失败不影响主流程
    console.error(`[dispatch-stats] 记录失败: ${err.message}`);
  }
}
```

---

## 2. 电路熔断器核心代码

### circuit-breaker.js 第 48-54 行：isAllowed()
```javascript
function isAllowed(key = 'default') {
  const s = getState(key);
  // CLOSED: always allowed
  // HALF_OPEN: allowed (probe)
  // OPEN: blocked
  return s.state !== 'OPEN';
}
```

### circuit-breaker.js 第 61-72 行：recordSuccess()
```javascript
async function recordSuccess(key = 'default') {
  const prev = getState(key);
  breakers.set(key, defaultState());

  if (prev.state === 'HALF_OPEN') {
    await emit('circuit_closed', 'circuit_breaker', {
      key,
      previous_state: prev.state,
      previous_failures: prev.failures
    });
  }
}
```

### circuit-breaker.js 第 78-106 行：recordFailure()
```javascript
async function recordFailure(key = 'default') {
  if (!breakers.has(key)) {
    breakers.set(key, defaultState());
  }
  const b = breakers.get(key);
  b.failures += 1;
  b.lastFailureAt = Date.now();

  if (b.state === 'HALF_OPEN') {
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'half_open_probe_failed',
      failures: b.failures
    });
    notifyCircuitOpen({ key, failures: b.failures, reason: 'half_open_probe_failed' }).catch(() => {});
  } else if (b.failures >= FAILURE_THRESHOLD && b.state === 'CLOSED') {
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'failure_threshold_reached',
      failures: b.failures
    });
    notifyCircuitOpen({ key, failures: b.failures, reason: 'failure_threshold_reached' }).catch(() => {});
  }
}
```

---

## 3. 派发执行流程核心代码

### executor.js 第 180-256 行：checkServerResources()
```javascript
function checkServerResources() {
  const load = os.loadavg();
  const memUsed = os.totalmem() - os.freemem();
  const memAvailable = os.freemem();
  const swapTotal = getSwapTotal();
  const swapUsed = getSwapUsed();
  const swapPercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;

  // Check CPU load
  if (Math.min(load[0], load[1], load[2]) >= LOAD_THRESHOLD) {
    return {
      ok: false,
      reason: 'high_cpu_load',
      metrics: { cpu_load: load[0].toFixed(2), threshold: LOAD_THRESHOLD.toFixed(2) }
    };
  }

  // Check memory availability
  const minAvailableMem = MEM_AVAILABLE_MIN_MB * 1024 * 1024;
  if (memAvailable < minAvailableMem) {
    return {
      ok: false,
      reason: 'insufficient_memory',
      metrics: { available_mb: Math.round(memAvailable / 1024 / 1024), min_mb: MEM_AVAILABLE_MIN_MB }
    };
  }

  // Check swap usage
  if (swapPercent > SWAP_USED_MAX_PCT) {
    return {
      ok: false,
      reason: 'high_swap_usage',
      metrics: { swap_pct: swapPercent.toFixed(1), max_pct: SWAP_USED_MAX_PCT }
    };
  }

  return { ok: true };
}
```

### executor.js 第 1051-1211 行：triggerCeceliaRun() 核心检查
```javascript
async function triggerCeceliaRun(task) {
  const location = getTaskLocation(task.task_type);
  if (location === 'hk') {
    return triggerMiniMaxExecutor(task);
  }

  const EXECUTOR_BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';
  const runId = generateRunId(task.id);

  try {
    // DEDUP CHECK
    const existing = activeProcesses.get(task.id);
    if (existing && isProcessAlive(existing.pid)) {
      return {
        success: false,
        taskId: task.id,
        reason: 'already_running',
        existingPid: existing.pid,
        existingRunId: existing.runId,
      };
    }
    if (existing) {
      activeProcesses.delete(task.id);
    }

    // RESOURCE CHECK
    const resources = checkServerResources();
    if (!resources.ok) {
      return {
        success: false,
        taskId: task.id,
        reason: 'server_overloaded',
        detail: resources.reason,
        metrics: resources.metrics,
      };
    }

    // ... HTTP dispatch to cecelia-bridge ...
    
    activeProcesses.set(task.id, {
      pid: null,
      startedAt: new Date().toISOString(),
      runId,
      checkpointId,
      bridge: true
    });

    return {
      success: true,
      runId,
      taskId: task.id,
      checkpointId,
      logFile: result.log_file,
      bridge: true
    };

  } catch (err) {
    return {
      success: false,
      taskId: task.id,
      error: err.message,
    };
  }
}
```

---

## 4. tick.js 派发流程核心代码

### tick.js 第 679-730 行：dispatchNextTask() 前序检查
```javascript
async function dispatchNextTask(goalIds) {
  const actions = [];

  // 0. Drain check
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  if (_draining || mitigationState.drain_mode_requested) {
    await recordDispatchResult(pool, false, 'draining');
    return { dispatched: false, reason: 'draining', detail: '...', actions };
  }

  // 0a. Billing pause check
  const billingPause = getBillingPause();
  if (billingPause.active) {
    await recordDispatchResult(pool, false, 'billing_pause');
    return { dispatched: false, reason: 'billing_pause', detail: '...', actions };
  }

  // 0b. Slot budget check
  const slotBudget = await calculateSlotBudget();
  if (!slotBudget.dispatchAllowed) {
    const slotReason = slotBudget.user.mode === 'team' ? 'user_team_mode' :
                       slotBudget.taskPool.budget === 0 ? 'pool_exhausted' : 'pool_c_full';
    await recordDispatchResult(pool, false, slotReason);
    return { dispatched: false, reason: slotReason, budget: slotBudget, actions };
  }

  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  // ... (继续任务选择和派发) ...
}
```

### tick.js 第 807-890 行：dispatchNextTask() 派发和记录
```javascript
  const execResult = await triggerCeceliaRun(fullTaskResult.rows[0]);

  // 5a. Check if executor actually succeeded
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    await recordFailure('cecelia-run');  // circuit-breaker
    await recordDispatchResult(pool, false, 'executor_failed');
    return { dispatched: false, reason: 'executor_failed', task_id: nextTask.id, error: execResult.error || execResult.reason, actions };
  }

  _lastDispatchTime = Date.now();

  // Publish events
  try {
    publishTaskStarted({
      id: nextTask.id,
      run_id: execResult.runId,
      title: nextTask.title
    });
  } catch (wsErr) {
    console.error(`[tick] WebSocket broadcast failed: ${wsErr.message}`);
  }

  await emit('task_dispatched', 'tick', {
    task_id: nextTask.id,
    title: nextTask.title,
    run_id: execResult.runId,
    success: execResult.success
  });

  // Record dispatch stats
  await recordDispatchResult(pool, true);

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}
```

---

## 5. 测试代码片段

### dispatch-stats.test.js 成功率计算测试
```javascript
it('计算成功率 - 混合结果（95%）', () => {
  const events = Array.from({ length: 100 }, (_, i) => ({
    ts: new Date(NOW - (i + 1) * 1000).toISOString(),
    success: i < 95,
    ...(i >= 95 ? { reason: 'circuit_breaker_open' } : {})
  }));
  const result = computeWindow1h(events, NOW);
  expect(result.total).toBe(100);
  expect(result.success).toBe(95);
  expect(result.failed).toBe(5);
  expect(result.rate).toBe(0.95);
  expect(result.failure_reasons['circuit_breaker_open']).toBe(5);
});
```

### dispatch-low-rate.test.js 低成功率熔断测试
```javascript
it('成功率 20%（< 30%）且样本 15 个 → 应触发熔断', () => {
  const events = makeEvents(15, 3); // 3/15 = 20%
  const { rate, total } = computeWindow1h(events, NOW);
  const shouldBlock = rate !== null && total >= DISPATCH_MIN_SAMPLE && rate < DISPATCH_RATE_THRESHOLD;
  expect(shouldBlock).toBe(true);
  expect(rate).toBeCloseTo(0.2);
  expect(total).toBe(15);
});
```

### circuit-breaker.test.js 三态转移测试
```javascript
it('CLOSED → OPEN after 3 failures, then HALF_OPEN after timeout', async () => {
  // Record 3 failures
  await recordFailure('test-worker');
  await recordFailure('test-worker');
  let state = getState('test-worker');
  expect(state.state).toBe('CLOSED');
  expect(state.failures).toBe(2);

  await recordFailure('test-worker');
  state = getState('test-worker');
  expect(state.state).toBe('OPEN');
  expect(state.failures).toBe(3);

  // Simulate timeout
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + OPEN_DURATION_MS + 1000);
  
  state = getState('test-worker');
  expect(state.state).toBe('HALF_OPEN');

  // Success → CLOSED
  await recordSuccess('test-worker');
  state = getState('test-worker');
  expect(state.state).toBe('CLOSED');
  expect(state.failures).toBe(0);
});
```

---

## 6. 派发失败原因映射表

```javascript
// tick.js 中的派发失败原因记录

const dispatchFailureReasons = {
  // 前序检查
  'draining': { trigger: 'drain check', recoverable: true },
  'billing_pause': { trigger: 'billing pause', recoverable: true },
  'user_team_mode': { trigger: 'slot budget', recoverable: true },
  'pool_exhausted': { trigger: 'slot budget', recoverable: true },
  'pool_c_full': { trigger: 'slot budget', recoverable: true },
  
  // 熔断器
  'circuit_breaker_open': { trigger: 'circuit breaker', recoverable: true },
  
  // 预检查
  'pre_flight_check_failed': { trigger: 'pre-flight', recoverable: false },
  
  // 执行器
  'no_executor': { trigger: 'executor check', recoverable: true },
  'task_not_found': { trigger: 'task lookup', recoverable: false },
  'executor_failed': { trigger: 'execution', recoverable: false },
  
  // 成功（派发）
  'success': { trigger: 'dispatch', recoverable: null }
};
```

---

## 7. 常用查询命令

### PostgreSQL 查询

```sql
-- 查看派发统计
SELECT 
  (value_json->>'last_updated') as last_updated,
  (value_json->'window_1h'->>'total')::int as total,
  (value_json->'window_1h'->>'success')::int as success,
  (value_json->'window_1h'->>'rate')::float as rate,
  value_json->'window_1h'->'failure_reasons' as failure_reasons
FROM working_memory 
WHERE key = 'dispatch_stats';

-- 查看最后 10 条派发事件
SELECT 
  (elem->>'ts') as ts,
  (elem->>'success') as success,
  (elem->>'reason') as reason
FROM working_memory,
jsonb_array_elements(value_json->'events') as elem
WHERE key = 'dispatch_stats'
ORDER BY (elem->>'ts') DESC
LIMIT 10;
```

### Bash 查询

```bash
# 获取派发统计 JSON
curl -s http://localhost:5221/api/brain/memory | \
  jq '.[] | select(.key == "dispatch_stats") | .value_json.window_1h'

# 查看失败原因分布
curl -s http://localhost:5221/api/brain/memory | \
  jq '.[] | select(.key == "dispatch_stats") | .value_json.window_1h.failure_reasons'

# 获取成功率
curl -s http://localhost:5221/api/brain/memory | \
  jq '.[] | select(.key == "dispatch_stats") | .value_json.window_1h.rate'
```

---

## 8. 数据结构定义

```javascript
// dispatch_stats 完整数据结构
{
  window_1h: {
    total: number,              // 1 小时内派发次数
    success: number,            // 成功次数
    failed: number,             // 失败次数
    rate: number | null,        // 成功率 (0-1)，null 表示无数据
    last_updated: string,       // ISO 时间戳
    failure_reasons: {          // 失败原因分布
      [reason: string]: number
    }
  },
  events: [
    {
      ts: string,               // ISO 时间戳
      success: boolean,         // 是否成功
      reason?: string           // 失败原因（仅 success=false 时）
    }
  ]
}

// circuit-breaker 状态结构
{
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',  // 当前状态
  failures: number,                         // 连续失败计数
  lastFailureAt: number | null,            // 最后失败时间戳
  openedAt: number | null                  // 打开时间戳
}
```

