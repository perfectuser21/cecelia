# Line 军师终态接线 + 两处工程收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task 落终态（completed/failed）后按其 line（journey_id）自动派发一个 `strategist_decision` 任务给 Brain 已有的 `line-strategist` skill，同时补齐 `advancement_items` 表结构与 Bark 容器 env 两处工程债。

**Architecture:** 新增一个 tick 插件（`line-strategist-dispatch-plugin.js`，遵循 `pipeline-patrol-plugin.js` 同款 `tick({pool, tickState, tickLog, intervalMs})` 接口），核心查询/派发逻辑放独立可单测模块 `line-strategist-dispatch.js`；`task-router.js` 三张路由表 + `TASK_REQUIREMENTS` 新增 `strategist_decision`；migration 325 给 `advancement_items` 加 `journey_id` 列 + 放宽 `ability_id`；`docker-compose.yml` / `.env.docker.example` 透传 `BARK_TOKEN`。

**Tech Stack:** Node.js (ESM), PostgreSQL, vitest

## Global Constraints

- 所有新建的 `strategist_decision` 任务必须设置 `trigger_source: 'brain_auto'`（`packages/brain/src/alertness/escalation.js:93` 的 `SYSTEM_AUTO_TRIGGER_SOURCES` 白名单成员之一），使其在 escalation 批量 pause 场景下被正确识别为系统自产任务
- `tasks` 表没有真实 `journey_id` 列，line 归属一律走 `payload->>'journey_id'`（不要新建假设不存在的列查询）
- 每个 tick 插件必须遵循"内部 try/catch，失败不冒泡到 tick-runner"的约定（参照 `pipeline-patrol-plugin.js`）
- migration 文件号：325（324 是当前最新）

---

### Task 1: 核心派发逻辑模块 `line-strategist-dispatch.js`

**Files:**
- Create: `packages/brain/src/line-strategist-dispatch.js`
- Test: `packages/brain/src/__tests__/line-strategist-dispatch.test.js`

**Interfaces:**
- Produces: `export async function dispatchStrategistDecisions(pool, { windowMinutes = 10 } = {})` — 返回 `{ scanned: number, dispatched: number, skipped_duplicate: number, marked: number }`

- [ ] **Step 1: 写失败测试 — 有新终态任务且无重复排队 → 建新任务**

```js
// packages/brain/src/__tests__/line-strategist-dispatch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const { dispatchStrategistDecisions } = await import('../line-strategist-dispatch.js');

describe('dispatchStrategistDecisions', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('creates a strategist_decision task when a terminal task has a journey_id and no queued dup exists', async () => {
    // 1. 扫描近期终态任务
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-1', journey_id: 'journey-abc', status: 'completed' }],
    });
    // 2. 查重：该 journey_id 无排队中的 strategist_decision
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT INTO tasks（新建 strategist_decision）
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] });
    // 4. UPDATE tasks payload 标记 strategist_dispatched（task-1）
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });

    const [insertSql, insertParams] = mockPool.query.mock.calls[2];
    expect(insertSql).toMatch(/INSERT INTO tasks/);
    expect(insertSql).toMatch(/trigger_source/);
    expect(insertParams).toContain('strategist_decision');
    expect(insertParams).toContain('brain_auto');
  });

  it('skips creating a new task when a queued strategist_decision already exists for the journey', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-1', journey_id: 'journey-abc', status: 'completed' }],
    });
    // 查重：已存在排队中的 strategist_decision
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] });
    // 仍然要标记 task-1，避免下一 tick 重复处理
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 1, dispatched: 0, skipped_duplicate: 1, marked: 1 });
    expect(mockPool.query).toHaveBeenCalledTimes(3); // 无 INSERT 调用
  });

  it('returns all zeros when no terminal tasks have a journey_id in the scan window', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0 });
    expect(mockPool.query).toHaveBeenCalledTimes(1); // 只有扫描查询，无后续
  });

  it('groups multiple terminal tasks with the same journey_id into a single dispatch', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'task-1', journey_id: 'journey-abc', status: 'completed' },
        { id: 'task-2', journey_id: 'journey-abc', status: 'failed' },
      ],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重（一次，因为同一 journey_id 只查一次）
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }); // INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-1
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-2

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch.test.js`
Expected: FAIL，报 `Cannot find module '../line-strategist-dispatch.js'`

- [ ] **Step 3: 写最小实现**

```js
// packages/brain/src/line-strategist-dispatch.js
/**
 * line-strategist-dispatch.js
 *
 * task 落终态（completed/failed）后，按其所属 line（journey_id，来自 payload）
 * 派发一个 task_type=strategist_decision 任务，触发 line-strategist skill。
 *
 * 轮询式而非侵入式：task 终态写入分散在 6+ 个文件的原始 SQL UPDATE 中，
 * 逐一插桩改动面大且易漏；改为周期扫描，与写入点解耦。
 *
 * 防抖去重两层：
 *  1. 扫描窗口只看近 N 分钟内落终态且未被本模块处理过的任务（payload.strategist_dispatched 标记）
 *  2. 建任务前查该 journey_id 是否已有排队中的 strategist_decision，存在则跳过
 */

export async function dispatchStrategistDecisions(pool, { windowMinutes = 10 } = {}) {
  const scanResult = await pool.query(
    `SELECT id, payload->>'journey_id' AS journey_id, status
     FROM tasks
     WHERE status IN ('completed', 'failed')
       AND payload->>'journey_id' IS NOT NULL
       AND updated_at > NOW() - ($1 || ' minutes')::INTERVAL
       AND NOT (payload ? 'strategist_dispatched')`,
    [windowMinutes]
  );

  const terminalTasks = scanResult.rows;
  if (terminalTasks.length === 0) {
    return { scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0 };
  }

  // 按 journey_id 分组
  const byJourney = new Map();
  for (const t of terminalTasks) {
    if (!byJourney.has(t.journey_id)) byJourney.set(t.journey_id, []);
    byJourney.get(t.journey_id).push(t);
  }

  let dispatched = 0;
  let skippedDuplicate = 0;

  for (const [journeyId, group] of byJourney) {
    const dupCheck = await pool.query(
      `SELECT 1 FROM tasks
       WHERE status = 'queued' AND task_type = 'strategist_decision'
         AND payload->>'journey_id' = $1
       LIMIT 1`,
      [journeyId]
    );

    if (dupCheck.rows.length > 0) {
      skippedDuplicate++;
    } else {
      await pool.query(
        `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          `Line 军师决策 — journey ${journeyId}`,
          `任务终态触发（run_terminal），line-strategist 分析该 line 近期完成/失败任务并给出决策`,
          'strategist_decision',
          'P2',
          'queued',
          JSON.stringify({
            journey_id: journeyId,
            trigger: 'run_terminal',
            trigger_context: { terminal_task_ids: group.map(t => t.id) },
          }),
          'brain_auto',
        ]
      );
      dispatched++;
    }
  }

  // 标记本轮已处理的任务，无论 3a 是查重跳过还是新建都要标记
  let marked = 0;
  for (const t of terminalTasks) {
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || '{"strategist_dispatched": true}'::jsonb
       WHERE id = $1`,
      [t.id]
    );
    marked++;
  }

  return { scanned: terminalTasks.length, dispatched, skipped_duplicate: skippedDuplicate, marked };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch.test.js`
Expected: PASS，4 个测试全绿

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/line-strategist-dispatch.js packages/brain/src/__tests__/line-strategist-dispatch.test.js
git commit -m "feat(brain): 新增 line-strategist-dispatch 核心派发逻辑"
```

---

### Task 2: tick 插件封装 + 接入 tick-runner.js

**Files:**
- Modify: `packages/brain/src/tick-state.js`
- Create: `packages/brain/src/line-strategist-dispatch-plugin.js`
- Modify: `packages/brain/src/tick-runner.js`
- Test: `packages/brain/src/__tests__/line-strategist-dispatch-plugin.test.js`

**Interfaces:**
- Consumes: `dispatchStrategistDecisions(pool, opts)` from Task 1（`../line-strategist-dispatch.js`）
- Produces: `export async function tick({ pool, tickState, tickLog, intervalMs })`（`line-strategist-dispatch-plugin.js` 默认导出 `{ tick }`，与 `pipeline-patrol-plugin.js` 同款接口）

- [ ] **Step 1: 在 `tick-state.js` 加节流字段**

在 `packages/brain/src/tick-state.js` 的 `tickState` 对象里，`lastPausedRequeuTime` 那一行后加：

```js
  lastLineStrategistDispatchTime: 0, // line-strategist 终态派发扫描
```

同样在 `resetTickStateForTests()` 里 `tickState.lastPausedRequeuTime = 0;` 后加：

```js
  tickState.lastLineStrategistDispatchTime = 0;
```

文件末尾 `_resetLastPausedRequeuTime` 函数后加对应 reset helper：

```js
/** Reset line-strategist dispatch timer — for testing only */
export function _resetLastLineStrategistDispatchTime() { tickState.lastLineStrategistDispatchTime = 0; }
```

- [ ] **Step 2: 写插件失败测试**

```js
// packages/brain/src/__tests__/line-strategist-dispatch-plugin.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDispatch = vi.hoisted(() => vi.fn());
vi.mock('../line-strategist-dispatch.js', () => ({ dispatchStrategistDecisions: mockDispatch }));

const { tick } = await import('../line-strategist-dispatch-plugin.js');

describe('line-strategist-dispatch-plugin tick', () => {
  beforeEach(() => mockDispatch.mockReset());

  it('runs dispatch and updates tickState timestamp when interval elapsed', async () => {
    mockDispatch.mockResolvedValueOnce({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });
    const tickState = { lastLineStrategistDispatchTime: 0 };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 1000 });

    expect(mockDispatch).toHaveBeenCalledWith(pool);
    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });
    expect(tickState.lastLineStrategistDispatchTime).toBeGreaterThan(0);
  });

  it('skips when interval has not elapsed', async () => {
    const tickState = { lastLineStrategistDispatchTime: Date.now() };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 60000 });

    expect(result).toEqual({ skipped: true, reason: 'throttled' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('catches errors from dispatchStrategistDecisions and returns error object', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('db down'));
    const tickState = { lastLineStrategistDispatchTime: 0 };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 1000 });

    expect(result).toEqual({ error: 'db down' });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch-plugin.test.js`
Expected: FAIL，`Cannot find module '../line-strategist-dispatch-plugin.js'`

- [ ] **Step 4: 写插件最小实现**

```js
// packages/brain/src/line-strategist-dispatch-plugin.js
/**
 * line-strategist-dispatch-plugin.js
 *
 * tick-runner.js 感知层插件：每 10 分钟扫描落终态任务，按 line 派发 strategist_decision。
 * 节流门同 pipeline-patrol-plugin.js 同款约定：elapsed < interval → { skipped, reason }。
 */

import { dispatchStrategistDecisions } from './line-strategist-dispatch.js';

const LINE_STRATEGIST_DISPATCH_INTERVAL_MS = parseInt(
  process.env.CECELIA_LINE_STRATEGIST_DISPATCH_INTERVAL_MS || String(10 * 60 * 1000),
  10
);

export async function tick({ pool, tickState, tickLog, intervalMs } = {}) {
  if (!tickState) throw new Error('line-strategist-dispatch-plugin: tickState required');
  const interval = intervalMs ?? LINE_STRATEGIST_DISPATCH_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastLineStrategistDispatchTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastLineStrategistDispatchTime = Date.now();
  try {
    const r = await dispatchStrategistDecisions(pool);
    if (r.dispatched > 0) {
      tickLog?.(`[tick] Line-strategist dispatch: scanned=${r.scanned} dispatched=${r.dispatched} skipped_dup=${r.skipped_duplicate}`);
    }
    return r;
  } catch (err) {
    console.error('[tick] Line-strategist dispatch failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch-plugin.test.js`
Expected: PASS，3 个测试全绿

- [ ] **Step 6: 接入 tick-runner.js**

在 `packages/brain/src/tick-runner.js` 顶部 import 区（`import * as pipelinePatrolPlugin from './pipeline-patrol-plugin.js';` 附近）加：

```js
import * as lineStrategistDispatchPlugin from './line-strategist-dispatch-plugin.js';
```

在 `pipelinePatrolPlugin.tick({ pool, tickState, tickLog }).catch(...)` 调用块后面加：

```js
  // [感知] Line 军师终态派发：每 10 分钟扫描落终态任务，按 line 建 strategist_decision
  lineStrategistDispatchPlugin.tick({ pool, tickState, tickLog }).catch(err => {
    console.error('[tick] Line-strategist dispatch plugin failed (non-fatal):', err.message);
  });
```

- [ ] **Step 7: 手动验证接入无语法错误**

Run: `cd packages/brain && node --check src/tick-runner.js`
Expected: 无输出（语法通过）

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/tick-state.js packages/brain/src/line-strategist-dispatch-plugin.js packages/brain/src/tick-runner.js packages/brain/src/__tests__/line-strategist-dispatch-plugin.test.js
git commit -m "feat(brain): line-strategist-dispatch tick 插件接入 tick-runner"
```

---

### Task 3: task-router.js 注册 strategist_decision

**Files:**
- Modify: `packages/brain/src/task-router.js`
- Test: `packages/brain/src/__tests__/task-router-strategist-decision.test.js`

**Interfaces:**
- Consumes: 无新增外部依赖
- Produces: `VALID_TASK_TYPES` / `SKILL_WHITELIST` / `LOCATION_MAP` / `TASK_REQUIREMENTS` 均含 `'strategist_decision'`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/task-router-strategist-decision.test.js
import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';

describe('task-router: strategist_decision registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('strategist_decision');
  });

  it('routes to /line-strategist skill', () => {
    expect(SKILL_WHITELIST['strategist_decision']).toBe('/line-strategist');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['strategist_decision']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['strategist_decision']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for strategist_decision', () => {
    const result = routeTaskCreate({ title: 'line decision', task_type: 'strategist_decision' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/line-strategist');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/task-router-strategist-decision.test.js`
Expected: FAIL（`strategist_decision` 不在任何映射表中，多个断言失败）

- [ ] **Step 3: 修改 task-router.js**

在 `VALID_TASK_TYPES` 数组（`packages/brain/src/task-router.js:16-58` 区间，`staging_e2e` 那一行前）加一行：

```js
  'strategist_decision',  // Line 军师决策：task 落终态后按 line 派发（line-strategist-dispatch-plugin.js）
```

在 `SKILL_WHITELIST` 对象（第71行起，紧邻 `'harness_generate'` 之类条目）加：

```js
  'strategist_decision': '/line-strategist',
```

在 `LOCATION_MAP` 对象（第220行起，紧邻 `'harness_generate': 'us',` 之类条目）加：

```js
  'strategist_decision': 'us',  // line-strategist 需读 git 历史 + decisions API → US
```

在 `TASK_REQUIREMENTS` 对象（第307行起，`'dev': ['has_git'],` 那一组 A 类里）加：

```js
  'strategist_decision':['has_git'],
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/task-router-strategist-decision.test.js`
Expected: PASS，5 个测试全绿

- [ ] **Step 5: 跑一次 task-router 全量测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/task-router*.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/task-router.js packages/brain/src/__tests__/task-router-strategist-decision.test.js
git commit -m "feat(brain): task-router 注册 strategist_decision 任务类型"
```

---

### Task 4: Migration 325 — advancement_items 加 journey_id / 放宽 ability_id

**Files:**
- Create: `packages/brain/migrations/325_advancement_items_journey_id.sql`
- Test: `packages/brain/src/__tests__/migration-325.test.js`

**Interfaces:**
- 无代码接口，纯 schema 变更

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/migration-325.test.js
import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../db.js')).default;
});

describe('migration 325: advancement_items journey_id + ability_id nullable', () => {
  it('advancement_items has a journey_id column referencing journeys', async () => {
    const result = await pool.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'advancement_items' AND column_name = 'journey_id'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('advancement_items.ability_id is nullable', async () => {
    const result = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'advancement_items' AND column_name = 'ability_id'
    `);
    expect(result.rows[0].is_nullable).toBe('YES');
  });

  it('advancement_items.journey_id has a foreign key to journeys', async () => {
    const result = await pool.query(`
      SELECT tc.constraint_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'advancement_items'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'journey_id'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-325.test.js`
Expected: FAIL（`journey_id` 列不存在，`ability_id` 仍是 `NO`）

- [ ] **Step 3: 写 migration 文件**

```sql
-- packages/brain/migrations/325_advancement_items_journey_id.sql
-- Migration 325: advancement_items 加 journey_id 列 + 放宽 ability_id 约束
-- 允许推进项挂纯 line 层级（暂未绑定具体 ability 的场景），补齐 T2(PR2 ability_id
-- 全链接线) 之后发现的缺口。

ALTER TABLE advancement_items ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_advancement_items_journey_id ON advancement_items (journey_id)
  WHERE journey_id IS NOT NULL;

ALTER TABLE advancement_items ALTER COLUMN ability_id DROP NOT NULL;
```

- [ ] **Step 4: 应用 migration（本地开发库）**

Run: `cd packages/brain && node src/migrate.js`
Expected: 输出包含 `325_advancement_items_journey_id.sql` 应用成功

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-325.test.js`
Expected: PASS，3 个测试全绿

- [ ] **Step 6: Commit**

```bash
git add packages/brain/migrations/325_advancement_items_journey_id.sql packages/brain/src/__tests__/migration-325.test.js
git commit -m "feat(brain): migration 325 — advancement_items 加 journey_id + 放宽 ability_id"
```

---

### Task 5: Bark token 透传进 Brain 容器 env

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.docker.example`

**Interfaces:**
- 无代码接口，纯配置变更

- [ ] **Step 1: 修改 docker-compose.yml**

在 `packages/brain` 所在的 `docker-compose.yml`（仓库根目录）的 `node-brain.environment` 列表里，`- FEISHU_BOT_WEBHOOK=${FEISHU_BOT_WEBHOOK:-}` 那一行后加：

```yaml
      # Bark 告警推送 token（source ~/.credentials/bark.env 后由宿主 shell 展开）
      - BARK_TOKEN=${BARK_TOKEN:-}
```

- [ ] **Step 2: 修改 .env.docker.example**

在 `.env.docker.example` 的 `=== Feishu ===` 小节后加一节：

```
# === Bark 告警推送 ===
# 源：1Password CS Vault "Bark" 条目 → ~/.credentials/bark.env
BARK_TOKEN=your-bark-device-token
```

- [ ] **Step 3: 验证 docker-compose.yml 语法合法**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: 无输出、退出码 0（语法/变量插值合法）

- [ ] **Step 4: 手动验证 BARK_TOKEN 已在 environment 列表中（CI 兼容断言）**

Run: `grep -c "BARK_TOKEN=" docker-compose.yml`
Expected: 输出 `1`（或更多，取决于是否已有其他引用；至少 ≥1）

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.docker.example
git commit -m "fix(brain): Bark token 补进 Brain 容器 env，修复容器化部署下告警推送静默失效"
```

---

## 完成后整体验证

- [ ] `cd packages/brain && npx vitest run` 全量测试通过（或 OOM 但全部 passed，见 package.json test script 的 OOM 容错逻辑）
- [ ] `node --check packages/brain/src/tick-runner.js` `node --check packages/brain/src/line-strategist-dispatch.js` `node --check packages/brain/src/line-strategist-dispatch-plugin.js` 均语法通过
- [ ] `docker compose config --quiet` 通过
