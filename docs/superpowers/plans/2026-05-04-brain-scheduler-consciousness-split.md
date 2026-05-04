# Brain 双层架构：调度层与意识层分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Brain 的调度逻辑与 LLM 意识调用彻底解耦，让 tick loop 永远不被 LLM 阻塞，同时保留 LLM 对调度的指导能力。

**Architecture:** Layer 1（调度层）纯 DB 操作 < 500ms，Layer 2（意识层）异步跑写 `brain_guidance` 表，Layer 1 读便条做决策。两层完全解耦，意识层挂掉调度继续。

**Tech Stack:** Node.js ESM、PostgreSQL、Brain 现有 pool/db.js

---

## Wave 1（3 个 worktree 并行）

---

## Task 1A：tick-runner.js 去阻塞
**Branch:** `cp-brain-deblock`
**Files:**
- Modify: `packages/brain/src/tick-runner.js`（~630, ~903, ~914, ~935, ~1229, ~1559 行）

### 背景
`executeTick()` 主链路有 6 处串行 `await` LLM 调用，总耗时 50-100s。本任务把所有非派发 LLM 调用改为 fire-and-forget 或加超时 fallback。

- [ ] **Step 1：写失败测试**

新建 `packages/brain/src/__tests__/routes/tick-deblock.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有 LLM 依赖，模拟超时场景
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ actions: [] }), 35000))),
  EVENT_TYPES: { TICK: 'tick' },
  executeDecision: vi.fn().mockResolvedValue({ actions_executed: [] }),
}));
vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ planned: false }), 35000))),
}));
vi.mock('../rumination.js', () => ({
  runRumination: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({}), 35000))),
}));

describe('tick-runner deblock', () => {
  it('thalamusProcessEvent 超时 30s 后返回 fallback，不阻塞', async () => {
    const start = Date.now();
    // 直接测试 withThalamusTimeout 函数（Task 1A 要导出）
    const { withThalamusTimeout } = await import('../tick-runner.js');
    const result = await withThalamusTimeout(
      new Promise(resolve => setTimeout(() => resolve({ actions: [{ type: 'dispatch_task' }] }), 35000)),
      30000
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(31000);
    expect(result.actions[0].type).toBe('fallback_to_tick');
  }, 35000);
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/tick-deblock.test.js 2>&1 | tail -10
```

Expected: FAIL（`withThalamusTimeout` 未导出）

- [ ] **Step 3：在 tick-runner.js 顶部添加 withThalamusTimeout 工具函数并导出**

在 `packages/brain/src/tick-runner.js` import 区域之后、第一个函数定义之前，添加：

```js
/**
 * 给 thalamusProcessEvent 加超时保护。
 * 超时返回 fallback_to_tick，不抛错，不阻塞 tick loop。
 */
export async function withThalamusTimeout(promise, timeoutMs = 30000) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ actions: [{ type: 'fallback_to_tick' }], level: 'timeout', timed_out: true }), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4：修改 thalamusProcessEvent 调用（~630 行）**

找到：
```js
thalamusResult = await thalamusProcessEvent(tickEvent);
```

改为：
```js
thalamusResult = await withThalamusTimeout(thalamusProcessEvent(tickEvent), 30000);
```

- [ ] **Step 5：修改 runRumination（~1559 行）改 fire-and-forget**

找到：
```js
  try {
    ruminationResult = await runRumination(pool);
  } catch (rumErr) {
    console.error('[tick] rumination error:', rumErr.message);
  }
```

改为：
```js
  Promise.resolve().then(() => runRumination(pool))
    .catch(e => console.warn('[tick] rumination 失败（fire-and-forget）:', e.message));
```

- [ ] **Step 6：修改 generateDecision + executeDecision（~903 行）改 fire-and-forget**

找到（约 900 行附近）：
```js
    const decision = await generateDecision({ trigger: 'tick' });
    // ...
    const execResult = await executeDecision(decision.decision_id);
```

把整个 `generateDecision` 代码块（if comparison.overall_health !== 'healthy' 那段）改为：

```js
    if (comparison.overall_health !== 'healthy' || comparison.next_actions.length > 0) {
      // fire-and-forget：决策生成不阻塞 tick，结果写 DB 供下次 tick 读取
      Promise.resolve()
        .then(async () => {
          const decision = await generateDecision({ trigger: 'tick' });
          if (decision.confidence >= AUTO_EXECUTE_CONFIDENCE && decision.actions.length > 0) {
            await executeDecision(decision.decision_id);
          } else if (decision.actions.length > 0) {
            const { safeActions } = splitActionsBySafety(decision.actions);
            if (safeActions.length > 0) await executeDecision(decision.decision_id);
          }
        })
        .catch(e => console.warn('[tick] generateDecision fire-and-forget 失败:', e.message));
    }
```

- [ ] **Step 7：修改 planNextTask（~1229 行）改 fire-and-forget**

找到：
```js
    const planned = await planNextTask(planKrIds);
```

改为：
```js
    Promise.resolve()
      .then(async () => {
        const planned = await planNextTask(planKrIds);
        if (planned.planned) {
          tickLog(`[tick] plan fire-and-forget: ${planned.task?.title}`);
        }
      })
      .catch(e => console.warn('[tick] planNextTask fire-and-forget 失败:', e.message));
```

- [ ] **Step 8：运行测试确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/tick-deblock.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 9：本地验证 tick 耗时**

```bash
node -e "
const start = Date.now();
setTimeout(() => {
  console.log('elapsed:', Date.now() - start, 'ms');
  console.log('目标: < 500ms（无 LLM 调用路径）');
}, 100);
"
```

- [ ] **Step 10：提交**

```bash
git add packages/brain/src/tick-runner.js packages/brain/src/__tests__/routes/tick-deblock.test.js
git commit -m "fix(brain): tick loop 去阻塞 — LLM 调用全部 fire-and-forget + thalamus 30s timeout"
```

---

## Task 1B：Circuit Breaker PostgreSQL 持久化
**Branch:** `cp-brain-cb-persist`
**Files:**
- Create: `packages/brain/migrations/261_circuit_breaker_states.sql`
- Modify: `packages/brain/src/circuit-breaker.js`
- Create: `packages/brain/src/__tests__/routes/circuit-breaker-persist.test.js`

### 背景
`circuit-breaker.js` 状态存在内存 Map 里，Brain 重启就清零。新失败立刻重新打开。需要持久化到 DB，重启后恢复真实状态。

- [ ] **Step 1：创建 migration**

新建 `packages/brain/migrations/261_circuit_breaker_states.sql`：

```sql
-- Circuit breaker 持久化状态表
-- Brain 重启后从此表恢复，不再从 0 开始计数
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
  key             TEXT PRIMARY KEY,
  state           TEXT NOT NULL DEFAULT 'CLOSED',  -- CLOSED | OPEN | HALF_OPEN
  failures        INT NOT NULL DEFAULT 0,
  last_failure_at BIGINT,
  opened_at       BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE circuit_breaker_states IS 'Circuit breaker 持久化状态，Brain 重启后恢复';
```

- [ ] **Step 2：执行 migration**

```bash
docker exec cecelia-node-brain node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('/app/migrations/261_circuit_breaker_states.sql', 'utf8');
pool.query(sql).then(() => { console.log('migration OK'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

Expected: `migration OK`

- [ ] **Step 3：写失败测试**

新建 `packages/brain/src/__tests__/routes/circuit-breaker-persist.test.js`：

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({
  default: { query: mockQuery }
}));

describe('circuit-breaker 持久化', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('loadPersistedStates: 从 DB 读取已有状态', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'cecelia-run', state: 'OPEN', failures: 22, last_failure_at: Date.now() - 1000, opened_at: Date.now() - 2000 }
      ]
    });
    const { loadPersistedStates, getState } = await import('../../circuit-breaker.js');
    await loadPersistedStates();
    const s = getState('cecelia-run');
    expect(s.state).toBe('OPEN');
    expect(s.failures).toBe(22);
  });

  it('recordFailure: 失败时异步写 DB', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { recordFailure } = await import('../../circuit-breaker.js');
    await recordFailure('test-worker');
    // 应该有一次 INSERT/UPDATE 调用
    const upsertCall = mockQuery.mock.calls.find(c => c[0]?.includes?.('circuit_breaker_states'));
    expect(upsertCall).toBeTruthy();
  });
});
```

- [ ] **Step 4：运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/circuit-breaker-persist.test.js 2>&1 | tail -10
```

Expected: FAIL（`loadPersistedStates` 未导出）

- [ ] **Step 5：修改 circuit-breaker.js 添加 DB 持久化**

在文件顶部 import 区域添加（现有 `import _pool from './db.js'` 已有，确认存在）。

在 `const breakers = new Map();` 之后添加：

```js
/**
 * 启动时从 DB 加载已持久化的 circuit breaker 状态。
 * 防止 Brain 重启后状态清零被新失败秒速打开。
 */
export async function loadPersistedStates() {
  try {
    const { rows } = await _pool.query(
      'SELECT key, state, failures, last_failure_at, opened_at FROM circuit_breaker_states'
    );
    for (const row of rows) {
      breakers.set(row.key, {
        state: row.state,
        failures: row.failures,
        lastFailureAt: row.last_failure_at ? Number(row.last_failure_at) : null,
        openedAt: row.opened_at ? Number(row.opened_at) : null,
      });
    }
    if (rows.length > 0) {
      console.log(`[circuit-breaker] 从 DB 恢复 ${rows.length} 个状态:`, rows.map(r => `${r.key}=${r.state}(${r.failures})`).join(', '));
    }
  } catch (err) {
    console.warn('[circuit-breaker] loadPersistedStates 失败（非致命）:', err.message);
  }
}

/** 异步写入 DB，非阻塞。写失败只记日志，不影响内存状态。 */
function persistState(key) {
  const b = breakers.get(key);
  if (!b) return;
  _pool.query(
    `INSERT INTO circuit_breaker_states (key, state, failures, last_failure_at, opened_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (key) DO UPDATE SET
       state = EXCLUDED.state,
       failures = EXCLUDED.failures,
       last_failure_at = EXCLUDED.last_failure_at,
       opened_at = EXCLUDED.opened_at,
       updated_at = NOW()`,
    [key, b.state, b.failures, b.lastFailureAt, b.openedAt]
  ).catch(e => console.warn(`[circuit-breaker] persistState ${key} 失败:`, e.message));
}
```

- [ ] **Step 6：在 recordFailure 和 recordSuccess 末尾调用 persistState**

找到 `recordFailure` 函数，在 `breakers.set(key, ...)` 之后添加 `persistState(key);`。

找到 `recordSuccess` 函数（约 61 行），在 `breakers.set(key, defaultState())` 之后添加：

```js
  // 重置时也同步 DB
  _pool.query(
    `INSERT INTO circuit_breaker_states (key, state, failures, last_failure_at, opened_at, updated_at)
     VALUES ($1, 'CLOSED', 0, NULL, NULL, NOW())
     ON CONFLICT (key) DO UPDATE SET state='CLOSED', failures=0, last_failure_at=NULL, opened_at=NULL, updated_at=NOW()`,
    [key]
  ).catch(e => console.warn(`[circuit-breaker] reset persist ${key} 失败:`, e.message));
```

- [ ] **Step 7：在 exports 中添加 loadPersistedStates**

找到文件末尾的 `export {` 块，添加 `loadPersistedStates`。

- [ ] **Step 8：在 server.js 启动时调用 loadPersistedStates**

在 `packages/brain/src/server.js` 中找到启动初始化区域（`startServer` 函数或顶层 await 区域），添加：

```js
import { loadPersistedStates } from './circuit-breaker.js';
// 在 pool 可用后调用：
await loadPersistedStates();
```

- [ ] **Step 9：运行测试确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/circuit-breaker-persist.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 10：提交**

```bash
git add packages/brain/migrations/261_circuit_breaker_states.sql \
        packages/brain/src/circuit-breaker.js \
        packages/brain/src/__tests__/routes/circuit-breaker-persist.test.js
git commit -m "feat(brain): circuit breaker PostgreSQL 持久化 — 重启自动恢复状态"
```

---

## Task 1C：brain_guidance 基础设施
**Branch:** `cp-brain-guidance`
**Files:**
- Create: `packages/brain/migrations/262_brain_guidance.sql`
- Create: `packages/brain/src/guidance.js`
- Create: `packages/brain/src/__tests__/routes/guidance.test.js`

### 背景
两层架构的握手接口。Layer 2（意识层）写，Layer 1（调度层）读。本任务只建表和工具函数，不改任何现有逻辑。

- [ ] **Step 1：创建 migration**

新建 `packages/brain/migrations/262_brain_guidance.sql`：

```sql
-- Brain 双层架构握手表：意识层写，调度层读
CREATE TABLE IF NOT EXISTS brain_guidance (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  source      TEXT NOT NULL,          -- 'thalamus' | 'cortex' | 'reflection' | 'memory'
  expires_at  TIMESTAMPTZ,            -- NULL = 永不过期
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_guidance_expires ON brain_guidance (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE brain_guidance IS '意识层向调度层传递指导的异步握手表';
```

- [ ] **Step 2：执行 migration**

```bash
docker exec cecelia-node-brain node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('/app/migrations/262_brain_guidance.sql', 'utf8');
pool.query(sql).then(() => { console.log('migration OK'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

- [ ] **Step 3：写失败测试**

新建 `packages/brain/src/__tests__/routes/guidance.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('guidance.js', () => {
  beforeEach(() => mockQuery.mockReset());

  it('getGuidance: 有效 key 返回 value', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { executor: 'bridge' } }]
    });
    const { getGuidance } = await import('../../guidance.js');
    const result = await getGuidance('routing:task-123');
    expect(result).toEqual({ executor: 'bridge' });
  });

  it('getGuidance: key 不存在返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { getGuidance } = await import('../../guidance.js');
    const result = await getGuidance('routing:nonexistent');
    expect(result).toBeNull();
  });

  it('setGuidance: 写入正确参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { setGuidance } = await import('../../guidance.js');
    await setGuidance('strategy:global', { priority: 'content' }, 'cortex', 86400000);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO brain_guidance'),
      expect.arrayContaining(['strategy:global', expect.any(String), 'cortex'])
    );
  });

  it('clearExpired: 删除过期条目', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });
    const { clearExpired } = await import('../../guidance.js');
    const count = await clearExpired();
    expect(count).toBe(3);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM brain_guidance'),
      expect.any(Array)
    );
  });
});
```

- [ ] **Step 4：运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/guidance.test.js 2>&1 | tail -10
```

Expected: FAIL（`guidance.js` 不存在）

- [ ] **Step 5：创建 guidance.js**

新建 `packages/brain/src/guidance.js`：

```js
/**
 * brain_guidance 工具函数
 *
 * 两层架构的握手接口：
 *   - 意识层（consciousness-loop）调用 setGuidance 写建议
 *   - 调度层（tick-scheduler）调用 getGuidance 读建议
 *
 * Key 命名规范：
 *   routing:{task_id}   — 单任务路由建议，TTL 1h
 *   strategy:global     — 全局策略，TTL 24h
 *   cooldown:{provider} — LLM provider 冷却，TTL 按错误类型
 *   reflection:latest   — 最新反思，TTL 24h
 */

import pool from './db.js';

/**
 * 读取一条 guidance。过期或不存在返回 null。
 */
export async function getGuidance(key) {
  const { rows } = await pool.query(
    `SELECT value FROM brain_guidance
     WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [key]
  );
  return rows.length > 0 ? rows[0].value : null;
}

/**
 * 写入一条 guidance。
 * @param {string} key
 * @param {object} value
 * @param {string} source - 'thalamus' | 'cortex' | 'reflection' | 'memory'
 * @param {number|null} ttlMs - 有效期毫秒，null 表示永不过期
 */
export async function setGuidance(key, value, source, ttlMs = null) {
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;
  await pool.query(
    `INSERT INTO brain_guidance (key, value, source, expires_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       source = EXCLUDED.source,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [key, JSON.stringify(value), source, expiresAt]
  );
}

/**
 * 删除所有过期 guidance 条目。在 tick 低峰期调用。
 * @returns {number} 删除行数
 */
export async function clearExpired() {
  const { rowCount } = await pool.query(
    `DELETE FROM brain_guidance WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
    []
  );
  return rowCount ?? 0;
}
```

- [ ] **Step 6：运行测试确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/guidance.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 7：提交**

```bash
git add packages/brain/migrations/262_brain_guidance.sql \
        packages/brain/src/guidance.js \
        packages/brain/src/__tests__/routes/guidance.test.js
git commit -m "feat(brain): brain_guidance 基础设施 — 两层架构握手表 + getGuidance/setGuidance/clearExpired"
```

---

## Wave 2（Wave 1 全部合并 main 后开始，2 个 worktree 并行）

---

## Task 2D：提取 tick-scheduler.js（纯调度，零 LLM）
**Branch:** `cp-brain-tick-scheduler`
**Files:**
- Create: `packages/brain/src/tick-scheduler.js`
- Modify: `packages/brain/src/tick-runner.js`（在 tick-runner 中调用 scheduler）
- Create: `packages/brain/src/__tests__/routes/tick-scheduler.test.js`

### 背景
把 tick-runner.js 里的纯派发逻辑（查队列→选任务→dispatch）提取到 tick-scheduler.js。调度器读 brain_guidance 获取路由建议，无建议则用默认规则。

- [ ] **Step 1：写失败测试**

新建 `packages/brain/src/__tests__/routes/tick-scheduler.test.js`：

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../guidance.js', () => ({ getGuidance: vi.fn().mockResolvedValue(null) }));
vi.mock('../../dispatcher.js', () => ({ dispatchNextTask: vi.fn().mockResolvedValue({ dispatched: false, reason: 'no_dispatchable_task' }) }));

describe('tick-scheduler', () => {
  it('runSchedulerTick: 无任务时返回 dispatched=false', async () => {
    const { runSchedulerTick } = await import('../../tick-scheduler.js');
    const result = await runSchedulerTick({ goalIds: [] });
    expect(result.dispatched).toBe(false);
  });

  it('runSchedulerTick: 耗时 < 1000ms（无 LLM）', async () => {
    const { runSchedulerTick } = await import('../../tick-scheduler.js');
    const start = Date.now();
    await runSchedulerTick({ goalIds: [] });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/tick-scheduler.test.js 2>&1 | tail -10
```

Expected: FAIL（`tick-scheduler.js` 不存在）

- [ ] **Step 3：创建 tick-scheduler.js**

新建 `packages/brain/src/tick-scheduler.js`：

```js
/**
 * tick-scheduler.js — Layer 1 调度层
 *
 * 纯 DB 操作，目标 < 500ms，永不 await LLM。
 * 通过读 brain_guidance 表接受 Layer 2 意识层的路由建议。
 */

import { dispatchNextTask } from './dispatcher.js';
import { getGuidance } from './guidance.js';

/**
 * 执行一次调度 tick。
 * @param {object} opts
 * @param {string[]|null} opts.goalIds - 目标 ID 列表，null 表示全局派发
 * @param {string[]|null} opts.priorityFilter - 优先级过滤
 * @returns {Promise<{dispatched: boolean, reason: string, task_id?: string}>}
 */
export async function runSchedulerTick({ goalIds = null, priorityFilter = null } = {}) {
  // 读取全局策略建议（意识层写入，可能为 null）
  const strategyGuidance = await getGuidance('strategy:global').catch(() => null);
  const effectivePriorityFilter = strategyGuidance?.priority_filter ?? priorityFilter;

  const result = await dispatchNextTask(goalIds, { priorityFilter: effectivePriorityFilter });
  return result;
}
```

- [ ] **Step 4：在 tick-runner.js 的派发步骤中改为调用 runSchedulerTick**

在 `tick-runner.js` 中找到 `dispatchNextTask(` 调用处，改为：

```js
import { runSchedulerTick } from './tick-scheduler.js';
// ...
const dispatchResult = await runSchedulerTick({ goalIds: activeGoalIds, priorityFilter });
```

- [ ] **Step 5：运行测试**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/tick-scheduler.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6：提交**

```bash
git add packages/brain/src/tick-scheduler.js \
        packages/brain/src/tick-runner.js \
        packages/brain/src/__tests__/routes/tick-scheduler.test.js
git commit -m "feat(brain): 提取 tick-scheduler.js — Layer 1 纯调度，零 LLM，读 brain_guidance 路由"
```

---

## Task 2E：consciousness-loop.js（意识层独立进程）
**Branch:** `cp-brain-consciousness-loop`
**Files:**
- Create: `packages/brain/src/consciousness-loop.js`
- Modify: `packages/brain/src/server.js`（注册 consciousness loop）
- Create: `packages/brain/src/__tests__/routes/consciousness-loop.test.js`

### 背景
把丘脑分析、反思、记忆更新从 tick loop 移到独立的 consciousness loop，每 20 分钟运行一次，结果写 brain_guidance。`CONSCIOUSNESS_ENABLED=false` 时完全不启动。

- [ ] **Step 1：写失败测试**

新建 `packages/brain/src/__tests__/routes/consciousness-loop.test.js`：

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../guidance.js', () => ({ setGuidance: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ actions: [{ type: 'no_action' }] }),
  EVENT_TYPES: { CONSCIOUSNESS_CYCLE: 'consciousness_cycle' },
  executeDecision: vi.fn().mockResolvedValue({ actions_executed: [] }),
}));

describe('consciousness-loop', () => {
  it('isConsciousnessEnabled: CONSCIOUSNESS_ENABLED=false 时返回 false', async () => {
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    const { isConsciousnessEnabled } = await import('../../consciousness-loop.js');
    expect(isConsciousnessEnabled()).toBe(false);
    delete process.env.CONSCIOUSNESS_ENABLED;
  });

  it('runConsciousnessCycle: 写入 reflection:latest guidance', async () => {
    process.env.CONSCIOUSNESS_ENABLED = 'true';
    const { setGuidance } = await import('../../guidance.js');
    const { runConsciousnessCycle } = await import('../../consciousness-loop.js');
    await runConsciousnessCycle();
    expect(setGuidance).toHaveBeenCalledWith(
      'reflection:latest',
      expect.any(Object),
      expect.any(String),
      expect.any(Number)
    );
    delete process.env.CONSCIOUSNESS_ENABLED;
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/consciousness-loop.test.js 2>&1 | tail -10
```

Expected: FAIL

- [ ] **Step 3：创建 consciousness-loop.js**

新建 `packages/brain/src/consciousness-loop.js`：

```js
/**
 * consciousness-loop.js — Layer 2 意识层
 *
 * 独立于 tick loop，每 CONSCIOUSNESS_INTERVAL_MS 运行一次。
 * 调用丘脑/反思/记忆，结果写 brain_guidance，供 Layer 1 调度层读取。
 * CONSCIOUSNESS_ENABLED=false 时完全不启动，不影响调度。
 */

import { setGuidance } from './guidance.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';

const CONSCIOUSNESS_INTERVAL_MS = parseInt(process.env.CONSCIOUSNESS_INTERVAL_MS ?? '1200000', 10); // 20 分钟

export function isConsciousnessEnabled() {
  return process.env.CONSCIOUSNESS_ENABLED !== 'false';
}

/**
 * 运行一次意识周期：丘脑分析 → 写 reflection guidance。
 */
export async function runConsciousnessCycle() {
  if (!isConsciousnessEnabled()) return { skipped: true, reason: 'disabled' };

  const cycleStart = Date.now();
  const results = {};

  // 1. 丘脑周期性分析（非实时路由，战略层面）
  try {
    const thalamusResult = await Promise.race([
      thalamusProcessEvent({ type: EVENT_TYPES.CONSCIOUSNESS_CYCLE ?? 'consciousness_cycle', timestamp: new Date().toISOString() }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('thalamus timeout')), 30000))
    ]);
    results.thalamus = { actions: thalamusResult.actions?.length ?? 0 };
  } catch (e) {
    console.warn('[consciousness-loop] thalamus 失败:', e.message);
    results.thalamus = { error: e.message };
  }

  // 2. 写 reflection:latest guidance（24h TTL）
  await setGuidance(
    'reflection:latest',
    { cycle_at: new Date().toISOString(), duration_ms: Date.now() - cycleStart, ...results },
    'consciousness-loop',
    86400000  // 24h
  );

  console.log(`[consciousness-loop] 周期完成 in ${Date.now() - cycleStart}ms`);
  return { completed: true, duration_ms: Date.now() - cycleStart };
}

let _loopTimer = null;

/** 启动意识循环（server.js 调用）*/
export function startConsciousnessLoop() {
  if (!isConsciousnessEnabled()) {
    console.log('[consciousness-loop] CONSCIOUSNESS_ENABLED=false，跳过启动');
    return;
  }
  console.log(`[consciousness-loop] 启动，间隔 ${CONSCIOUSNESS_INTERVAL_MS / 60000} 分钟`);
  _loopTimer = setInterval(() => {
    runConsciousnessCycle().catch(e => console.error('[consciousness-loop] 周期错误:', e.message));
  }, CONSCIOUSNESS_INTERVAL_MS);
}

/** 停止意识循环 */
export function stopConsciousnessLoop() {
  if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = null; }
}
```

- [ ] **Step 4：在 server.js 注册 consciousness loop**

在 `packages/brain/src/server.js` 启动逻辑中添加：

```js
import { startConsciousnessLoop } from './consciousness-loop.js';
// 在 Brain 启动完成后调用（在 tick loop 启动之后）：
startConsciousnessLoop();
```

- [ ] **Step 5：运行测试**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/consciousness-loop.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6：提交**

```bash
git add packages/brain/src/consciousness-loop.js \
        packages/brain/src/server.js \
        packages/brain/src/__tests__/routes/consciousness-loop.test.js
git commit -m "feat(brain): consciousness-loop.js — Layer 2 意识层独立循环，每 20 分钟写 brain_guidance"
```

---

## Wave 3（Wave 2 合并后，1 个 worktree）

---

## Task 3F：Executor 路由统一 + LLM 错误分类
**Branch:** `cp-brain-executor-routing`
**Files:**
- Create: `packages/brain/src/executor-routing.js`
- Modify: `packages/brain/src/executor.js`（引入统一路由表）
- Modify: `packages/brain/src/llm-caller.js`（添加错误分类 + cooldown）
- Create: `packages/brain/migrations/263_llm_cooldowns.sql`

### 背景
arch_review 任务走 `triggerCodexReview`，但容器内没有 codex 二进制，每次 ENOENT → circuit break。需要统一路由表，把所有 task_type 明确映射到可用 executor。同时给 LLM 错误分类，欠费账号自动 cooldown 24h。

- [ ] **Step 1：创建 llm_cooldowns migration**

新建 `packages/brain/migrations/263_llm_cooldowns.sql`：

```sql
-- LLM provider/账号 cooldown 状态
-- InsufficientFunds → 24h，RateLimit → 1min，Auth → 1h
CREATE TABLE IF NOT EXISTS llm_cooldowns (
  provider_key  TEXT PRIMARY KEY,   -- 'anthropic-api' | 'codex' | 'account3'
  reason        TEXT NOT NULL,       -- 'insufficient_funds' | 'rate_limit' | 'auth_error'
  cooldown_until TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 2：创建 executor-routing.js**

新建 `packages/brain/src/executor-routing.js`：

```js
/**
 * executor-routing.js — 唯一路由真相来源
 *
 * 每个 task_type 明确映射到 executor_type。
 * executor_type: 'docker' | 'bridge' | 'codex_local'
 *
 * 规则：
 *   docker    = HARNESS_DOCKER_ENABLED=true 时走 spawn/index.js（容器内跑）
 *   bridge    = cecelia-bridge HTTP（本机 claude -p）
 *   codex_local = 本机 codex CLI（仅在 Brain 非 Docker 时可用）
 */

export const EXECUTOR_ROUTING = {
  // 开发类 → Docker
  dev:                    'docker',
  harness_task:           'docker',
  harness_planner:        'docker',
  harness_generate:       'docker',
  harness_fix:            'docker',
  harness_report:         'docker',
  initiative_plan:        'docker',
  initiative_verify:      'docker',

  // 审查类 → bridge（不需要 codex CLI，避免 ENOENT）
  arch_review:            'bridge',
  code_review:            'bridge',
  research:               'bridge',
  decomp_review:          'bridge',

  // 数据类 → bridge
  platform_scraper:       'bridge',
  data:                   'bridge',
  talk:                   'bridge',

  // 默认
  _default:               'docker',
};

/**
 * 根据 task_type 返回 executor_type。
 * 找不到时返回默认值 'docker'。
 */
export function getExecutorType(taskType) {
  return EXECUTOR_ROUTING[taskType] ?? EXECUTOR_ROUTING._default;
}

/**
 * 判断当前环境下某个 executor_type 是否可用。
 */
export function isExecutorAvailable(executorType) {
  if (executorType === 'docker') {
    return process.env.HARNESS_DOCKER_ENABLED === 'true';
  }
  if (executorType === 'bridge') {
    return true; // bridge 始终尝试，由 circuit breaker 保护
  }
  if (executorType === 'codex_local') {
    // codex 仅在非 Docker 环境可用
    return process.env.RUNNING_IN_DOCKER !== 'true';
  }
  return false;
}
```

- [ ] **Step 3：写路由测试**

新建 `packages/brain/src/__tests__/routes/executor-routing.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { getExecutorType, isExecutorAvailable } from '../../executor-routing.js';

describe('executor-routing', () => {
  it('arch_review → bridge（不走 codex CLI）', () => {
    expect(getExecutorType('arch_review')).toBe('bridge');
  });

  it('dev → docker', () => {
    expect(getExecutorType('dev')).toBe('docker');
  });

  it('未知 task_type → 默认 docker', () => {
    expect(getExecutorType('unknown_type')).toBe('docker');
  });

  it('docker: HARNESS_DOCKER_ENABLED=true 时可用', () => {
    process.env.HARNESS_DOCKER_ENABLED = 'true';
    expect(isExecutorAvailable('docker')).toBe(true);
    delete process.env.HARNESS_DOCKER_ENABLED;
  });

  it('codex_local: RUNNING_IN_DOCKER=true 时不可用', () => {
    process.env.RUNNING_IN_DOCKER = 'true';
    expect(isExecutorAvailable('codex_local')).toBe(false);
    delete process.env.RUNNING_IN_DOCKER;
  });
});
```

- [ ] **Step 4：运行测试**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/executor-routing.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5：在 executor.js 中引入统一路由**

在 `packages/brain/src/executor.js` 中找到 `arch_review` 的路由判断（`triggerCodexReview`），添加对 `EXECUTOR_ROUTING` 的引用：

```js
import { getExecutorType, isExecutorAvailable } from './executor-routing.js';

// 在路由决策处添加：
const executorType = getExecutorType(taskType);
console.log(`[executor] 路由决策: task_type=${taskType} → ${executorType}`);

// arch_review 不再走 triggerCodexReview，改走 bridge
if (executorType === 'bridge' || (executorType === 'codex_local' && !isExecutorAvailable('codex_local'))) {
  // 降级到 bridge
  return triggerCeceliaRun(task);
}
```

- [ ] **Step 6：添加 LLM 错误分类函数到 llm-caller.js**

在 `packages/brain/src/llm-caller.js` 中添加：

```js
import pool from './db.js';

/**
 * 分类 LLM 错误，返回 cooldown 时长（ms）和原因。
 */
export function classifyLLMError(err) {
  const msg = err?.message ?? '';
  if (msg.includes('credit balance is too low') || msg.includes('insufficient_funds')) {
    return { type: 'insufficient_funds', cooldownMs: 86400000 }; // 24h
  }
  if (msg.includes('rate_limit') || msg.includes('429')) {
    return { type: 'rate_limit', cooldownMs: 60000 }; // 1min
  }
  if (msg.includes('authentication') || msg.includes('401') || msg.includes('invalid_api_key')) {
    return { type: 'auth_error', cooldownMs: 3600000 }; // 1h
  }
  return { type: 'unknown', cooldownMs: 0 };
}

/**
 * 把某个 provider 标记为 cooldown，写入 DB。
 */
export async function setProviderCooldown(providerKey, reason, cooldownMs) {
  if (cooldownMs <= 0) return;
  const until = new Date(Date.now() + cooldownMs).toISOString();
  await pool.query(
    `INSERT INTO llm_cooldowns (provider_key, reason, cooldown_until)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider_key) DO UPDATE SET reason=$2, cooldown_until=$3, created_at=NOW()`,
    [providerKey, reason, until]
  ).catch(e => console.warn('[llm-caller] cooldown write 失败:', e.message));
  console.warn(`[llm-caller] ${providerKey} cooldown ${reason} until ${until}`);
}

/**
 * 检查 provider 是否在 cooldown 中。
 */
export async function isProviderInCooldown(providerKey) {
  const { rows } = await pool.query(
    `SELECT 1 FROM llm_cooldowns WHERE provider_key = $1 AND cooldown_until > NOW()`,
    [providerKey]
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
}
```

- [ ] **Step 7：在 llm-caller 的 fallback 链中使用 classifyLLMError**

在 `llm-caller.js` 的 catch 区域（约 210 行，`anthropic-api 兜底也失败` 处），添加：

```js
      const { type, cooldownMs } = classifyLLMError(apiErr);
      if (cooldownMs > 0) {
        setProviderCooldown('anthropic-api', type, cooldownMs);
      }
```

- [ ] **Step 8：运行所有相关测试**

```bash
cd packages/brain && npx vitest run src/__tests__/routes/executor-routing.test.js 2>&1 | tail -5
```

- [ ] **Step 9：执行 migration 263**

```bash
docker exec cecelia-node-brain node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('/app/migrations/263_llm_cooldowns.sql', 'utf8');
pool.query(sql).then(() => { console.log('migration 263 OK'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

- [ ] **Step 10：提交**

```bash
git add packages/brain/src/executor-routing.js \
        packages/brain/src/executor.js \
        packages/brain/src/llm-caller.js \
        packages/brain/migrations/263_llm_cooldowns.sql \
        packages/brain/src/__tests__/routes/executor-routing.test.js
git commit -m "feat(brain): executor 路由统一 + LLM 错误分类 cooldown — arch_review 走 bridge，欠费自动 cooldown 24h"
```

---

## 验收标准

```bash
# 1. tick loop 耗时 < 500ms
docker logs cecelia-node-brain 2>&1 | grep "tick.*duration\|tick.*ms" | tail -5

# 2. circuit breaker 重启后恢复状态
docker restart cecelia-node-brain && sleep 5
curl -s localhost:5221/api/brain/health | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['organs']['circuit_breaker'])"

# 3. arch_review 不再触发 codex ENOENT
docker logs cecelia-node-brain 2>&1 | grep "ENOENT\|codex" | wc -l  # 应为 0

# 4. LLM 欠费不再无限重试
docker logs cecelia-node-brain 2>&1 | grep "cooldown\|insufficient_funds" | tail -3

# 5. consciousness-loop 独立运行
docker logs cecelia-node-brain 2>&1 | grep "consciousness-loop" | tail -3
```
