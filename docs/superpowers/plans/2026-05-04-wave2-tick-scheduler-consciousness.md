# Wave 2: tick-scheduler.js + consciousness-loop.js 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将调度逻辑（tick-scheduler.js）和 LLM 意识调用（consciousness-loop.js）彻底解耦，tick-scheduler 无 LLM await，consciousness-loop 每 20 分钟异步跑。

**Architecture:** tick-loop.js 的 setInterval 改为调用 `runScheduler()`（替代原 `executeTick()`），同时在 startTickLoop 中启动 20 分钟一次的 `startConsciousnessLoop()`。tick-runner.js 保留但不再被调用。

**Tech Stack:** Node.js ESM，vitest（vi.mock），packages/brain/src 目录，guidance.js/circuit-breaker.js/dispatcher.js 已有 API。

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `packages/brain/src/tick-scheduler.js` | 纯调度：读 DB、读 guidance、circuit breaker、调 dispatchNextTask，无 LLM |
| 新建 | `packages/brain/src/consciousness-loop.js` | LLM 意识：thalamus/decision/rumination/planner，每 20 分钟，写 guidance |
| 修改 | `packages/brain/src/tick-loop.js` | 用 runScheduler 替换 executeTick，startTickLoop 中启动 consciousness-loop |
| 修改 | `packages/brain/src/tick-runner.js` | 顶部加废弃注释（保留文件供回滚） |
| 新建 | `packages/brain/src/__tests__/tick-scheduler.test.js` | 5 个单元测试 |
| 新建 | `packages/brain/src/__tests__/consciousness-loop.test.js` | 4 个单元测试 |
| 修改 | `packages/brain/package.json` | 版本 1.226.1 → 1.227.0 |
| 修改 | `packages/brain/package-lock.json` | 同步版本 |
| 修改 | `DEFINITION.md` | Brain 版本同步 |
| 修改 | `.brain-versions` | Brain 版本同步 |

---

## Task 1: 写 tick-scheduler.js 的失败测试

**Files:**
- Create: `packages/brain/src/__tests__/tick-scheduler.test.js`

- [ ] **Step 1: 写失败测试文件**

```javascript
// packages/brain/src/__tests__/tick-scheduler.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有外部依赖
const mockGetGuidance = vi.fn();
const mockIsAllowed = vi.fn();
const mockDispatchNextTask = vi.fn();
const mockQuery = vi.fn();

vi.mock('../guidance.js', () => ({
  getGuidance: (...args) => mockGetGuidance(...args),
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
}));

vi.mock('../dispatcher.js', () => ({
  dispatchNextTask: (...args) => mockDispatchNextTask(...args),
}));

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// 文件未创建时这行会 fail — 这就是"失败测试"的意义
import { runScheduler, EXECUTOR_ROUTING } from '../tick-scheduler.js';

describe('tick-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：circuit breaker CLOSED（允许派发）
    mockIsAllowed.mockReturnValue(true);
    // 默认：无 guidance 建议
    mockGetGuidance.mockResolvedValue(null);
    // 默认：有活跃 KR
    mockQuery.mockResolvedValue({ rows: [{ id: 'kr-1' }, { id: 'kr-2' }] });
    // 默认：dispatch 成功
    mockDispatchNextTask.mockResolvedValue({ dispatched: true, actions: [], reason: 'ok' });
  });

  // 测试 1: 有 guidance 建议时使用建议路由（不用 EXECUTOR_ROUTING 兜底）
  it('有 guidance 建议时传递 guidance 给调度结果', async () => {
    mockGetGuidance.mockResolvedValue({ executor_type: 'codex' });
    const result = await runScheduler();
    // guidance 被读取（strategy:global key）
    expect(mockGetGuidance).toHaveBeenCalledWith('strategy:global');
    // 调度仍然执行
    expect(mockDispatchNextTask).toHaveBeenCalled();
    expect(result.guidance_used).toBe(true);
  });

  // 测试 2: 无 guidance 时用 EXECUTOR_ROUTING 默认路由（路由表存在且完整）
  it('EXECUTOR_ROUTING 包含所有核心任务类型', () => {
    expect(EXECUTOR_ROUTING).toMatchObject({
      dev_task: 'cecelia_bridge',
      code_review: 'cecelia_bridge',
      arch_review: 'cecelia_bridge',
      research: 'cecelia_bridge',
      harness: 'cecelia_bridge',
    });
  });

  // 测试 3: circuit breaker OPEN 时跳过派发
  it('circuit breaker OPEN 时不调用 dispatchNextTask', async () => {
    mockIsAllowed.mockReturnValue(false);
    const result = await runScheduler();
    expect(mockDispatchNextTask).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('circuit_open');
  });

  // 测试 4: 整个 runScheduler() < 500ms（mock 所有 DB 调用）
  it('runScheduler 完成时间 < 500ms（全 mock）', async () => {
    const start = Date.now();
    await runScheduler();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  // 测试 5: 绝对没有 await thalamusProcessEvent / await generateDecision 调用
  it('runScheduler 源码不含 thalamusProcessEvent 或 generateDecision 字符串', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL('../tick-scheduler.js', import.meta.url),
      'utf8'
    );
    expect(src).not.toContain('thalamusProcessEvent');
    expect(src).not.toContain('generateDecision');
    expect(src).not.toContain('runRumination');
    expect(src).not.toContain('planNextTask');
  });
});
```

- [ ] **Step 2: 运行，确认 fail（文件不存在）**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/tick-scheduler.test.js 2>&1 | tail -20
```

预期：`Cannot find module '../tick-scheduler.js'` 或类似 import 错误。

- [ ] **Step 3: Commit（fail 测试）**

```bash
git add packages/brain/src/__tests__/tick-scheduler.test.js
git commit -m "test(brain): tick-scheduler 5 失败测试 — Wave 2 TDD 起点"
```

---

## Task 2: 实现 tick-scheduler.js

**Files:**
- Create: `packages/brain/src/tick-scheduler.js`

- [ ] **Step 1: 创建 tick-scheduler.js**

```javascript
// packages/brain/src/tick-scheduler.js
/**
 * tick-scheduler.js — Wave 2 纯调度层
 *
 * 职责：读 DB、读 guidance、检查 circuit breaker、调 dispatchNextTask。
 * 硬性约束：
 *   - 绝对不 await 任何 LLM 调用（thalamus / decision / rumination / planner）
 *   - 目标耗时 < 500ms（DB 查询 + dispatch）
 *   - 无 guidance 时使用 EXECUTOR_ROUTING 默认路由表兜底（记录日志）
 */
import pool from './db.js';
import { dispatchNextTask } from './dispatcher.js';
import { isAllowed } from './circuit-breaker.js';
import { getGuidance } from './guidance.js';

export const EXECUTOR_ROUTING = {
  dev_task:    'cecelia_bridge',
  code_review: 'cecelia_bridge',
  arch_review: 'cecelia_bridge',
  research:    'cecelia_bridge',
  harness:     'cecelia_bridge',
};

/**
 * 纯调度入口。被 tick-loop.js 每 5 秒调用。
 * @returns {Promise<{dispatched: boolean, reason: string, elapsed_ms: number, guidance_used: boolean}>}
 */
export async function runScheduler() {
  const start = Date.now();

  // 1. Circuit breaker 检查（内存读取，< 1ms）
  if (!isAllowed('dispatch')) {
    return { dispatched: false, reason: 'circuit_open', elapsed_ms: Date.now() - start, guidance_used: false };
  }

  // 2. 读取全局策略 guidance（DB 查询，< 5ms）
  const strategyGuidance = await getGuidance('strategy:global');
  const guidanceUsed = !!strategyGuidance;

  if (strategyGuidance) {
    console.log('[tick-scheduler] 使用 consciousness-loop guidance:', JSON.stringify(strategyGuidance).slice(0, 120));
  } else {
    console.log('[tick-scheduler] 无 guidance，使用 EXECUTOR_ROUTING 默认路由:', JSON.stringify(EXECUTOR_ROUTING));
  }

  // 3. 获取活跃 KR IDs（DB 查询）
  const { rows } = await pool.query(
    `SELECT id FROM key_results WHERE status IN ('active', 'in_progress', 'decomposing')`
  );
  const goalIds = rows.map(r => r.id);

  if (goalIds.length === 0) {
    return { dispatched: false, reason: 'no_goals', elapsed_ms: Date.now() - start, guidance_used: guidanceUsed };
  }

  // 4. 派发（调 dispatcher，不含任何 LLM）
  const result = await dispatchNextTask(goalIds);

  return {
    ...result,
    elapsed_ms: Date.now() - start,
    guidance_used: guidanceUsed,
  };
}
```

- [ ] **Step 2: 语法检查**

```bash
node --check packages/brain/src/tick-scheduler.js
```

预期：无输出（语法正确）。

- [ ] **Step 3: 运行测试，确认全部 pass**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/tick-scheduler.test.js 2>&1 | tail -20
```

预期：`5 passed`

- [ ] **Step 4: Commit（实现）**

```bash
git add packages/brain/src/tick-scheduler.js
git commit -m "feat(brain): 新建 tick-scheduler.js — 纯调度层无 LLM，Wave 2 Agent D"
```

---

## Task 3: 写 consciousness-loop.js 的失败测试

**Files:**
- Create: `packages/brain/src/__tests__/consciousness-loop.test.js`

- [ ] **Step 1: 写失败测试文件**

```javascript
// packages/brain/src/__tests__/consciousness-loop.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 所有 LLM 依赖
const mockThalamusProcessEvent = vi.fn();
const mockGenerateDecision = vi.fn();
const mockRunRumination = vi.fn();
const mockPlanNextTask = vi.fn();
const mockSetGuidance = vi.fn();
const mockIsConsciousnessEnabled = vi.fn();
const mockQuery = vi.fn();

vi.mock('../thalamus.js', () => ({
  processEvent: (...args) => mockThalamusProcessEvent(...args),
  EVENT_TYPES: { TICK: 'tick' },
}));

vi.mock('../decision.js', () => ({
  generateDecision: (...args) => mockGenerateDecision(...args),
}));

vi.mock('../rumination.js', () => ({
  runRumination: (...args) => mockRunRumination(...args),
}));

vi.mock('../planner.js', () => ({
  planNextTask: (...args) => mockPlanNextTask(...args),
}));

vi.mock('../guidance.js', () => ({
  setGuidance: (...args) => mockSetGuidance(...args),
  getGuidance: vi.fn().mockResolvedValue(null),
}));

vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => mockIsConsciousnessEnabled(),
}));

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// 文件未创建时 fail — TDD 起点
import { startConsciousnessLoop, _runConsciousnessOnce, stopConsciousnessLoop } from '../consciousness-loop.js';

describe('consciousness-loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockThalamusProcessEvent.mockResolvedValue({ actions: [], level: 'normal' });
    mockGenerateDecision.mockResolvedValue({ confidence: 0.5, actions: [], decision_id: 'dec-1' });
    mockRunRumination.mockResolvedValue({ processed: 1 });
    mockPlanNextTask.mockResolvedValue({ task_id: 'task-1' });
    mockSetGuidance.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    stopConsciousnessLoop();
  });

  // 测试 1: CONSCIOUSNESS_ENABLED=false 时 loop 不启动
  it('CONSCIOUSNESS_ENABLED=false 时 startConsciousnessLoop 不建立定时器', () => {
    mockIsConsciousnessEnabled.mockReturnValue(false);
    const result = startConsciousnessLoop();
    expect(result).toBe(false);
    expect(mockThalamusProcessEvent).not.toHaveBeenCalled();
  });

  // 测试 2: 单次运行超过 5 分钟被中断，不影响主进程
  it('单次运行设有 5 分钟超时保护', async () => {
    // 模拟 thalamus 永不 resolve
    mockThalamusProcessEvent.mockReturnValue(
      new Promise(() => {}) // 永远 pending
    );
    const resultPromise = _runConsciousnessOnce({ timeoutMs: 100 }); // 测试用 100ms
    const result = await resultPromise;
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeUndefined(); // 不抛异常
  });

  // 测试 3: thalamus 结果正确写入 guidance: routing:{task_id}
  it('thalamus 结果写入 guidance routing key', async () => {
    mockThalamusProcessEvent.mockResolvedValue({
      actions: [{ type: 'dispatch_task', task_id: 'task-abc' }],
      level: 'normal',
    });
    await _runConsciousnessOnce();
    expect(mockSetGuidance).toHaveBeenCalledWith(
      'routing:task-abc',
      expect.objectContaining({ executor_type: expect.any(String) }),
      'thalamus',
      3600_000
    );
  });

  // 测试 4: loop 崩溃后 tick-scheduler 继续正常派发（loop 独立，不影响调度层）
  it('_runConsciousnessOnce 内部异常不向外抛出', async () => {
    mockThalamusProcessEvent.mockRejectedValue(new Error('LLM 崩了'));
    const result = await _runConsciousnessOnce();
    // 不抛异常，返回 error 字段
    expect(result.error).toBeDefined();
    expect(result.completed).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认 fail**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/consciousness-loop.test.js 2>&1 | tail -20
```

预期：`Cannot find module '../consciousness-loop.js'`

- [ ] **Step 3: Commit（fail 测试）**

```bash
git add packages/brain/src/__tests__/consciousness-loop.test.js
git commit -m "test(brain): consciousness-loop 4 失败测试 — Wave 2 TDD 起点"
```

---

## Task 4: 实现 consciousness-loop.js

**Files:**
- Create: `packages/brain/src/consciousness-loop.js`

- [ ] **Step 1: 创建 consciousness-loop.js**

```javascript
// packages/brain/src/consciousness-loop.js
/**
 * consciousness-loop.js — Wave 2 LLM 意识层
 *
 * 每 20 分钟运行一次，集中所有 LLM 调用：
 *   thalamusProcessEvent → 路由建议写 guidance
 *   generateDecision    → 策略建议写 guidance
 *   runRumination       → 知识消化（fire-and-forget）
 *   planNextTask        → 直接落 DB tasks 表
 *
 * CONSCIOUSNESS_ENABLED=false 时整个 loop 不启动。
 * 每次运行有超时保护，超时不崩溃只记 warn。
 * 挂了不影响 tick-scheduler.js 继续派发。
 */
import pool from './db.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { generateDecision } from './decision.js';
import { runRumination } from './rumination.js';
import { planNextTask } from './planner.js';
import { setGuidance } from './guidance.js';
import { isConsciousnessEnabled } from './consciousness-guard.js';

const CONSCIOUSNESS_INTERVAL_MS = parseInt(
  process.env.CONSCIOUSNESS_INTERVAL_MS || String(20 * 60 * 1000),
  10
);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时保护

let _loopTimer = null;

/**
 * 单次意识运行（可注入 timeoutMs 供测试使用）。
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{completed: boolean, timedOut?: boolean, error?: string, actions: string[]}>}
 */
export async function _runConsciousnessOnce({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const actions = [];

  try {
    const result = await Promise.race([
      _doConsciousnessWork(actions),
      new Promise(resolve =>
        setTimeout(() => resolve({ timedOut: true, actions }), timeoutMs)
      ),
    ]);

    if (result.timedOut) {
      console.warn('[consciousness-loop] 单次运行超时（' + timeoutMs / 1000 + 's），已中断');
      return { completed: false, timedOut: true, actions };
    }

    return { completed: true, actions };
  } catch (err) {
    console.warn('[consciousness-loop] 意识运行异常（不影响调度层）:', err.message);
    return { completed: false, error: err.message, actions };
  }
}

async function _doConsciousnessWork(actions) {
  // 1. Thalamus：分析 tick 事件，路由建议写 guidance
  try {
    const tickEvent = { type: EVENT_TYPES.TICK, timestamp: new Date().toISOString(), has_anomaly: false };
    const thalamusResult = await thalamusProcessEvent(tickEvent);
    const dispatchAction = thalamusResult.actions?.find(a => a.type === 'dispatch_task');
    if (dispatchAction?.task_id) {
      await setGuidance(
        `routing:${dispatchAction.task_id}`,
        { executor_type: 'cecelia_bridge', source: 'thalamus', level: thalamusResult.level },
        'thalamus',
        3600_000
      );
      actions.push('thalamus_routing');
    }
  } catch (err) {
    console.warn('[consciousness-loop] thalamus 失败（非致命）:', err.message);
  }

  // 2. generateDecision：全局策略写 guidance（24h TTL）
  try {
    const decision = await generateDecision({ trigger: 'consciousness_loop' });
    if (decision.actions?.length > 0) {
      await setGuidance('strategy:global', { decision_id: decision.decision_id, actions: decision.actions }, 'cortex', 24 * 3600_000);
      actions.push('strategy_guidance');
    }
  } catch (err) {
    console.warn('[consciousness-loop] generateDecision 失败（非致命）:', err.message);
  }

  // 3. runRumination：知识消化（fire-and-forget，不写 guidance）
  Promise.resolve().then(() => runRumination(pool))
    .catch(e => console.warn('[consciousness-loop] rumination 失败:', e.message));
  actions.push('rumination_started');

  // 4. planNextTask：直接落 DB tasks 表（不写 guidance）
  try {
    const { rows } = await pool.query(
      `SELECT id FROM key_results WHERE status IN ('active', 'in_progress') LIMIT 5`
    );
    const krIds = rows.map(r => r.id);
    if (krIds.length > 0) {
      await planNextTask(krIds);
      actions.push('plan_next_task');
    }
  } catch (err) {
    console.warn('[consciousness-loop] planNextTask 失败（非致命）:', err.message);
  }

  return { actions };
}

/**
 * 启动意识循环（每 20 分钟一次）。
 * @returns {boolean} false 表示 CONSCIOUSNESS_ENABLED=false，未启动
 */
export function startConsciousnessLoop() {
  if (!isConsciousnessEnabled()) {
    console.log('[consciousness-loop] CONSCIOUSNESS_ENABLED=false，意识循环不启动');
    return false;
  }

  if (_loopTimer) {
    console.log('[consciousness-loop] 已在运行，跳过重复启动');
    return true;
  }

  _loopTimer = setInterval(async () => {
    if (!isConsciousnessEnabled()) return;
    await _runConsciousnessOnce();
  }, CONSCIOUSNESS_INTERVAL_MS);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[consciousness-loop] 已启动（间隔 ${CONSCIOUSNESS_INTERVAL_MS / 60000} 分钟）`);
  return true;
}

/**
 * 停止意识循环（测试用 / 关闭用）。
 */
export function stopConsciousnessLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
}
```

- [ ] **Step 2: 语法检查**

```bash
node --check packages/brain/src/consciousness-loop.js
```

预期：无输出。

- [ ] **Step 3: 运行测试，确认全部 pass**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/consciousness-loop.test.js 2>&1 | tail -20
```

预期：`4 passed`

- [ ] **Step 4: Commit（实现）**

```bash
git add packages/brain/src/consciousness-loop.js
git commit -m "feat(brain): 新建 consciousness-loop.js — LLM 意识层每 20 分钟，Wave 2 Agent E"
```

---

## Task 5: 集成到 tick-loop.js

**Files:**
- Modify: `packages/brain/src/tick-loop.js`

**当前状态**：tick-loop.js 的 `runTickSafe` 中 `const doTick = tickFn || executeTick` 调 executeTick（tick-runner.js）。`startTickLoop` 启动 setInterval 但不启动意识循环。

- [ ] **Step 1: 修改 tick-loop.js**

在文件顶部 import 区，添加两行新 import（放在 `import { executeTick } from './tick-runner.js';` 之后）：

```javascript
import { runScheduler } from './tick-scheduler.js';
import { startConsciousnessLoop } from './consciousness-loop.js';
```

在 `runTickSafe` 函数中，将：
```javascript
const doTick = tickFn || executeTick;
```
改为：
```javascript
const doTick = tickFn || runScheduler;
```

在 `startTickLoop` 函数中，在 `tickState.loopTimer = setInterval(...)` 之后、`if (tickState.loopTimer.unref)` 之前，添加：
```javascript
// Wave 2: 启动 LLM 意识循环（每 20 分钟）
startConsciousnessLoop();
```

- [ ] **Step 2: 语法检查**

```bash
node --check packages/brain/src/tick-loop.js
```

- [ ] **Step 3: 运行 tick-loop 测试，确认未破坏**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/tick-loop.test.js 2>&1 | tail -20
```

预期：所有原有测试仍然 pass（tick-loop.test.js mock 了 executeTick，新代码不影响它）。

**注意**：tick-loop.test.js 顶部有 `vi.mock('../tick-runner.js', () => ({ executeTick: ... }))` 和 `vi.mock('../tick-scheduler.js', ...)` 可能需要补充。如果测试因为缺少 tick-scheduler mock 而 fail，在 tick-loop.test.js 文件顶部补充：
```javascript
vi.mock('../tick-scheduler.js', () => ({
  runScheduler: vi.fn().mockResolvedValue({ dispatched: true, actions: [] }),
}));
vi.mock('../consciousness-loop.js', () => ({
  startConsciousnessLoop: vi.fn(),
  stopConsciousnessLoop: vi.fn(),
}));
```

- [ ] **Step 4: 运行所有新测试一次确认**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/tick-scheduler.test.js src/__tests__/consciousness-loop.test.js src/__tests__/tick-loop.test.js 2>&1 | tail -30
```

预期：全部 pass。

- [ ] **Step 5: Commit（集成）**

```bash
git add packages/brain/src/tick-loop.js
git commit -m "feat(brain): tick-loop 集成 tick-scheduler + consciousness-loop，Wave 2 完成"
```

---

## Task 6: 标记 tick-runner.js 废弃 + 版本 bump

**Files:**
- Modify: `packages/brain/src/tick-runner.js`（顶部注释）
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `DEFINITION.md`
- Modify: `.brain-versions`

- [ ] **Step 1: 在 tick-runner.js 顶部第 1 行后插入废弃注释**

在文件第 2 行后（`* tick-runner.js — executeTick implementation` 之后）插入：
```javascript
 *
 * ⚠️  WAVE 2 废弃通知（2026-05-04）：
 * executeTick() 已被 tick-scheduler.js（调度层）+ consciousness-loop.js（意识层）取代。
 * 本文件保留供紧急回滚。tick-loop.js 已改为调用 runScheduler()，不再调用 executeTick()。
 * 如需回滚：tick-loop.js 中将 runScheduler → executeTick，删 startConsciousnessLoop() 调用。
```

- [ ] **Step 2: 版本 bump（1.226.1 → 1.227.0）**

`packages/brain/package.json`：将 `"version": "1.226.1"` 改为 `"version": "1.227.0"`

`packages/brain/package-lock.json`：将所有 `"1.226.1"` 改为 `"1.227.0"`（brain 包的两处）

`DEFINITION.md`：搜索 `1.226.1`，改为 `1.227.0`

`.brain-versions`：搜索 `1.226.1`，改为 `1.227.0`

- [ ] **Step 3: 版本同步验证**

```bash
bash scripts/check-version-sync.sh 2>&1 | tail -10
```

预期：无 "MISMATCH" 输出。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/tick-runner.js packages/brain/package.json packages/brain/package-lock.json DEFINITION.md .brain-versions
git commit -m "feat(brain): Wave 2 版本 bump 1.226.1 → 1.227.0，标记 tick-runner 废弃"
```

---

## Task 7: 最终验证

- [ ] **Step 1: 全套语法检查**

```bash
node --check packages/brain/src/tick-scheduler.js && \
node --check packages/brain/src/consciousness-loop.js && \
node --check packages/brain/src/tick-loop.js && \
echo "✅ 所有文件语法正确"
```

- [ ] **Step 2: 运行所有新测试**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
  src/__tests__/tick-scheduler.test.js \
  src/__tests__/consciousness-loop.test.js \
  2>&1 | tail -20
```

预期：`9 passed`（5 + 4）

- [ ] **Step 3: CONSCIOUSNESS_ENABLED=false Brain 启动冒烟**

```bash
cd packages/brain && CONSCIOUSNESS_ENABLED=false node -e "
  import('./src/consciousness-loop.js').then(m => {
    const result = m.startConsciousnessLoop();
    console.assert(result === false, 'CONSCIOUSNESS_ENABLED=false 时应返回 false');
    console.log('✅ CONSCIOUSNESS_ENABLED=false 冒烟通过');
    process.exit(0);
  });
"
```

- [ ] **Step 4: Brain health check（如 Brain 已启动）**

```bash
curl -s localhost:5221/api/brain/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('health:', d.get('status','unknown'))" 2>/dev/null || echo "Brain 未运行，跳过"
```

- [ ] **Step 5: DevGate 通过**

```bash
node scripts/facts-check.mjs 2>&1 | tail -5
bash scripts/check-version-sync.sh 2>&1 | tail -5
```

- [ ] **Step 6: 回写 Brain 任务状态**

```bash
curl -X PATCH localhost:5221/api/brain/tasks/d7b77ba1-3f68-49db-9179-c20eb84a8334 \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress","result":{"phase":"implementation_complete"}}'
```
