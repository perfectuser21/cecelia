# 健康看板僵尸指标修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tick 统计接回活路径（runScheduler）、capability-probe 复活、janitor docker-prune 取消，让 /health 看板反映真实状态。

**Architecture:** 新增 `tick-stats.js` 纯写入模块（deps.pool 可注入）；`tick-loop.js` 两处一行级接线（runTickSafe 记统计、startTickLoop 启 probe）；`dispatcher.js` 派发成功点一行接线；janitor 移除 docker-prune 注册与文件。不改废弃的 tick-runner.js。

**Tech Stack:** Node.js ESM + vitest。

## Global Constraints

- 注释/commit 全简体中文；TDD：commit-1 failing test（Red）→ commit-2 实现（Green）
- 统计写入失败绝不抛出、绝不阻塞 tick 主循环（只 console.warn）
- 不改 packages/brain/src/tick-runner.js
- brain 版本 1.243.2 → 1.243.3（package.json + package-lock + DEFINITION.md + .brain-versions，check-version-sync.sh 必须绿）

---

### Task 1: tick-stats 模块 + 接线（TDD）

**Files:**
- Create: `packages/brain/src/tick-stats.js`
- Create: `packages/brain/src/__tests__/tick-stats.test.js`
- Modify: `packages/brain/src/tick-loop.js`（import + runTickSafe try 块内两行）
- Modify: `packages/brain/src/dispatcher.js`（import + 成功派发点一行）

**Interfaces:**
- Produces: `recordTickExecution(durationMs, deps={}): Promise<void>`、`incrementActionsToday(count=1, deps={}): Promise<number|null>`（均吞错不抛）

- [ ] **Step 1: 写 failing 测试 `packages/brain/src/__tests__/tick-stats.test.js`（完整内容）**

```js
/**
 * tick-stats — tick 统计写入活路径模块（Wave-2 断链修复）。
 * 背景：tick_execution_stats/tick_last/tick_actions_today 的写入方在废弃的
 * executeTick 体内，runScheduler 活路径从不写 → 三 key 冻在 2026-05-05。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

import { recordTickExecution, incrementActionsToday } from '../tick-stats.js';

function makeClient(existingStats) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockImplementation(async (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: existingStats ? [{ value_json: existingStats }] : [] };
    return { rows: [] };
  });
  return client;
}

beforeEach(() => { mockPool.query.mockReset(); mockPool.connect.mockReset(); });

describe('recordTickExecution', () => {
  it('累加 total_executions 并 UPSERT tick_execution_stats + tick_last', async () => {
    const client = makeClient({ total_executions: 7 });
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await recordTickExecution(1234, { pool });
    const upsert = client.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_execution_stats');
    expect(upsert).toBeTruthy();
    expect(upsert[1][1]).toMatchObject({ total_executions: 8, last_duration_ms: 1234 });
    expect(typeof upsert[1][1].last_executed_at).toBe('string');
    const tickLast = pool.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_last');
    expect(tickLast).toBeTruthy();
    expect(typeof tickLast[1][1].timestamp).toBe('string');
  });

  it('无既有行时从 0 起计', async () => {
    const client = makeClient(null);
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await recordTickExecution(50, { pool });
    const upsert = client.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]) && c[1]?.[0] === 'tick_execution_stats');
    expect(upsert[1][1].total_executions).toBe(1);
  });

  it('DB 抛错时吞掉不抛出（绝不拖垮 tick 主循环）', async () => {
    const pool = { connect: vi.fn().mockRejectedValue(new Error('db down')), query: vi.fn() };
    await expect(recordTickExecution(10, { pool })).resolves.toBeUndefined();
  });
});

describe('incrementActionsToday', () => {
  it('同日累加', async () => {
    const today = new Date().toISOString().split('T')[0];
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/SELECT/.test(sql)) return { rows: [{ value_json: { date: today, count: 3 } }] };
      return { rows: [] };
    });
    const n = await incrementActionsToday(1, { pool });
    expect(n).toBe(4);
    const upsert = pool.query.mock.calls.find((c) => /INSERT INTO working_memory/.test(c[0]));
    expect(upsert[1][1]).toEqual({ date: today, count: 4 });
  });

  it('跨日重置', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/SELECT/.test(sql)) return { rows: [{ value_json: { date: '2026-05-05', count: 692 } }] };
      return { rows: [] };
    });
    const n = await incrementActionsToday(1, { pool });
    expect(n).toBe(1);
  });

  it('DB 抛错时吞掉返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(incrementActionsToday(1, { pool })).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-stats.test.js 2>&1 | tail -8`
Expected: FAIL（模块不存在）。必须亲眼看到红。

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/tick-stats.test.js
git commit -m "test(brain): tick-stats 活路径统计模块 failing 测试 (Red)"
```

- [ ] **Step 4: 实现 `packages/brain/src/tick-stats.js`（完整内容）**

```js
/**
 * tick-stats.js — tick 统计写入（Wave-2 断链修复）。
 * 原写入方在废弃的 executeTick（tick-runner.js L1494/L219）体内，
 * runScheduler 活路径从不写 → tick_execution_stats/tick_last/tick_actions_today
 * 冻在 2026-05-05。本模块抽出等价逻辑供活路径调用；tick-runner 保留不动（回滚用）。
 * 两个函数都吞错不抛：统计属旁路观测，绝不拖垮 tick 主循环。
 */
import pool from './db.js';

const TICK_STATS_KEY = 'tick_execution_stats';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';

export async function recordTickExecution(durationMs, deps = {}) {
  const db = deps.pool || pool;
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const row = await client.query(
      'SELECT value_json FROM working_memory WHERE key = $1 FOR UPDATE',
      [TICK_STATS_KEY]
    );
    const current = row.rows[0]?.value_json || { total_executions: 0 };
    const lastExecutedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const stats = {
      total_executions: (current.total_executions || 0) + 1,
      last_executed_at: lastExecutedAt,
      last_duration_ms: durationMs,
    };
    await client.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_STATS_KEY, stats]
    );
    await client.query('COMMIT');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('[tick-stats] recordTickExecution 失败（旁路，不影响 tick）:', err.message);
    return;
  } finally {
    if (client) client.release();
  }
  try {
    await db.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_LAST_KEY, { timestamp: new Date().toISOString() }]
    );
  } catch (err) {
    console.warn('[tick-stats] tick_last 写入失败（旁路）:', err.message);
  }
}

export async function incrementActionsToday(count = 1, deps = {}) {
  const db = deps.pool || pool;
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [TICK_ACTIONS_TODAY_KEY]
    );
    const current = result.rows[0]?.value_json || { date: today, count: 0 };
    const newCount = current.date === today ? current.count + count : count;
    await db.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_ACTIONS_TODAY_KEY, { date: today, count: newCount }]
    );
    return newCount;
  } catch (err) {
    console.warn('[tick-stats] incrementActionsToday 失败（旁路）:', err.message);
    return null;
  }
}
```

- [ ] **Step 5: 接线 tick-loop.js**

在 import 区加：
```js
import { recordTickExecution } from './tick-stats.js';
```
在 `runTickSafe` 的 try 块里（`const result = await doTick();` 与 `tickState.lastExecuteTime = Date.now();` 之后、`tickLog(...)` 之前）插入：
```js
    // Wave-2 断链修复：统计写入接回活路径（fire-and-forget，吞错）
    recordTickExecution(Date.now() - tickState.tickLockTime).catch(() => {});
```
注意：`tickState.tickLockTime` 在 doTick 前被赋值为开始时间，finally 里才清空——try 块内可用作耗时基准。

- [ ] **Step 6: 接线 dispatcher.js**

在 import 区加：
```js
import { incrementActionsToday } from './tick-stats.js';
```
定位**真派发成功**返回点：`grep -n "dispatched: true" packages/brain/src/dispatcher.js`——在实际 spawn/派发成功后 return `{ dispatched: true, ... }` 的那一处（非 mock/短路分支）之前插入：
```js
      // Wave-2 断链修复：派发成功计入当日 actions（fire-and-forget，吞错）
      incrementActionsToday(1).catch(() => {});
```
若有多处真成功返回点，每处都加（同一注释）。

- [ ] **Step 7: 跑测试确认 Green + 相关模块无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-stats.test.js src/__tests__/tick-loop*.test.js src/__tests__/dispatcher*.test.js 2>&1 | tail -8`
Expected: tick-stats 全 PASS；tick-loop/dispatcher 既有测试全 PASS（若既有 mock 因新 import 报错，给对应测试文件加 `vi.mock('../tick-stats.js', () => ({ recordTickExecution: vi.fn().mockResolvedValue(undefined), incrementActionsToday: vi.fn().mockResolvedValue(1) }))`，不改断言）。

- [ ] **Step 8: Commit（Green）**

```bash
git add packages/brain/src/tick-stats.js packages/brain/src/tick-loop.js packages/brain/src/dispatcher.js packages/brain/src/__tests__/
git commit -m "fix(brain): tick 统计写入接回 runScheduler 活路径——tick_execution_stats/tick_last/tick_actions_today 解冻"
```

---

### Task 2: capability-probe 复活 + janitor docker-prune 取消

**Files:**
- Modify: `packages/brain/src/tick-loop.js`（startTickLoop 加一行）
- Modify: `packages/brain/src/janitor.js`（REGISTRY 清空）
- Delete: `packages/brain/src/janitor-jobs/docker-prune.js`、`packages/brain/src/__tests__/docker-prune.test.js`
- Modify: `packages/brain/src/__tests__/janitor.test.js`
- Test: `packages/brain/src/__tests__/tick-loop-probe.test.js`（新增）

**Interfaces:**
- Consumes: `startProbeLoop()`（capability-probe.js 既有导出，自带 1h setInterval + 30s 首跑 + `_probeTimer` 幂等 guard）

- [ ] **Step 1: 写 failing 测试 `packages/brain/src/__tests__/tick-loop-probe.test.js`**

```js
/**
 * probe 复活回归锁：startProbeLoop 自 Wave-2 后全仓零调用方（probe 死于 05-22），
 * 本测试锁定 startTickLoop 必须启动 probe loop（与 harness-watchdog/recovery/patrol 同模式）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));
vi.mock('../capability-probe.js', () => ({ startProbeLoop: vi.fn() }));
vi.mock('../consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('../harness-watchdog-loop.js', () => ({ startHarnessWatchdogLoop: vi.fn(), stopHarnessWatchdogLoop: vi.fn() }));
vi.mock('../recovery-loop.js', () => ({ startRecoveryLoop: vi.fn(), stopRecoveryLoop: vi.fn() }));
vi.mock('../pipeline-patrol-loop.js', () => ({ startPipelinePatrolLoop: vi.fn(), stopPipelinePatrolLoop: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishCognitiveState: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ recordTickExecution: vi.fn().mockResolvedValue(undefined) }));

import { startTickLoop, stopTickLoop } from '../tick-loop.js';
import { startProbeLoop } from '../capability-probe.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => stopTickLoop());

describe('startTickLoop', () => {
  it('启动时调用 startProbeLoop（probe 复活）', () => {
    startTickLoop();
    expect(startProbeLoop).toHaveBeenCalledOnce();
  });
});
```

注意：若 tick-loop.js 还有其他顶层 import（如 tick-state.js）导致 mock 缺口，按报错补 `vi.mock`，不改断言。

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-loop-probe.test.js 2>&1 | tail -6`
Expected: FAIL——`startProbeLoop` 未被调用（expected 1 call, got 0）。

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/tick-loop-probe.test.js
git commit -m "test(brain): probe 复活回归锁 failing 测试 (Red)"
```

- [ ] **Step 4: 实现——tick-loop.js 启 probe + janitor 移除 docker-prune**

tick-loop.js import 区加：
```js
import { startProbeLoop } from './capability-probe.js';
```
在 `startTickLoop()` 里启动其他兄弟 loop 的位置（startHarnessWatchdogLoop/startRecoveryLoop/startPipelinePatrolLoop 附近）加：
```js
  // Wave-2 断链修复：capability-probe 复活（模块自带 1h interval + 幂等 guard）
  startProbeLoop();
```

janitor.js：删除 `import * as dockerPrune from './janitor-jobs/docker-prune.js';`，`const REGISTRY = [dockerPrune];` 改为：
```js
// docker-prune 已取消（2026-07-08 用户拍板：旧机制 + 部署自杀竞态 Issue 97cf5a41）。
// 框架保留：新 job import 后加进 REGISTRY 即可。
const REGISTRY = [];
```

删文件：
```bash
git rm packages/brain/src/janitor-jobs/docker-prune.js packages/brain/src/__tests__/docker-prune.test.js
```

更新 `packages/brain/src/__tests__/janitor.test.js`：移除对 docker-prune 的 vi.mock 与相关用例，改为断言 `getJobs` 返回 `{ jobs: [] }`（mock pool 两个查询都返回空 rows）、`runJob(pool, 'docker-prune')` reject 含 `Unknown job`。保持文件其余结构。

- [ ] **Step 5: 跑测试确认 Green**

Run: `cd packages/brain && npx vitest run src/__tests__/tick-loop-probe.test.js src/__tests__/janitor.test.js 2>&1 | tail -6`
Expected: 全 PASS。

- [ ] **Step 6: Commit（Green）**

```bash
git add -A packages/brain/src packages/brain/src/__tests__
git commit -m "fix(brain): capability-probe 复活（startTickLoop 启动）+ janitor docker-prune 取消注册"
```

---

### Task 3: 版本 bump + DevGate + Learning

**Files:**
- Modify: `packages/brain/package.json` / `package-lock.json` / `DEFINITION.md` / `.brain-versions`（1.243.2 → 1.243.3）
- Create: `docs/learnings/cp-07081605-health-zombie-metrics.md`

- [ ] **Step 1: bump 版本**

```bash
cd packages/brain && npm version 1.243.3 --no-git-tag-version && cd ../..
# DEFINITION.md 与 .brain-versions 里 1.243.2 → 1.243.3（grep -rn "1.243.2" DEFINITION.md .brain-versions 找到行后编辑）
```

- [ ] **Step 2: DevGate 校验**

Run: `bash scripts/check-version-sync.sh && node scripts/facts-check.mjs`
Expected: 都 ✅（报缺哪处就补哪处重跑到绿）。

- [ ] **Step 3: 写 Learning `docs/learnings/cp-07081605-health-zombie-metrics.md`**

```markdown
# 健康看板僵尸指标：观测写入随架构迁移断链两个月无人发现

### 根本原因
Wave-2 把 executeTick 换成 runScheduler 时，统计写入（tick_execution_stats/tick_last/tick_actions_today）和 capability-probe 启动都留在废弃路径体内，活路径不写不启 → /health 冻在 2026-05-05、probe 冻在 05-22，形成"Brain 老死"假象；因为没有任何闸门断言"观测数据必须新鲜"，僵尸态存活两个月。

### 下次预防
- [ ] 架构迁移（换主循环/换调度器）时必须 grep 旧路径体内全部副作用（统计/启动/巡检），逐个迁移或显式声明放弃
- [ ] 观测指标要配"新鲜度哨兵"：health 端点对 updated_at 超过 N 天的统计字段标 stale，而不是原样透传
- [ ] 看板显示的每个字段，问一句"写入方还活着吗"——僵尸指标比没有指标更危险
```

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json DEFINITION.md .brain-versions docs/learnings/cp-07081605-health-zombie-metrics.md
git commit -m "chore(brain): bump 1.243.3 + learning（健康看板僵尸指标修复）"
```
