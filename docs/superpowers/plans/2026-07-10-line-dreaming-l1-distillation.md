# dreaming L1 line 级夜间蒸馏 job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增夜间 scheduler job，每晚把每条 active line（journey）的 24h 事实蒸馏成一份 `design_docs(type='line_ledger')` 摘要，并让 diary / arch_review / strategy_session 三个下游改为消费这份摘要而非各自重查原始数据。

**Architecture:** 沿用 `scheduler-jobs.js` 现有注册表模式（`battle-report.js` 是最贴近的先例：窗口判断 + 20h 去重 + `design_docs` 写入）。新文件 `packages/brain/src/line-dreaming.js` 负责蒸馏与落库；`scheduler-jobs.js` 注册；`diary-scheduler.js` 与 `daily-review-scheduler.js`（`triggerArchReview`）/`active-goals-zero-trigger.js`（`maybeTriggerStrategySession`）三处新增"读取 line_ledger 注入上下文"的逻辑。

**Tech Stack:** Node.js ESM，PostgreSQL（`pg` Pool），vitest 单测（mock pool，同 `battle-report.test.js` 模式）。

## Global Constraints

- 所有新 SQL 必须走参数化查询（`$1`/`$2`），禁止字符串拼接
- 新 migration 编号为 `328`（仓库当前最大为 `327_ci_patrol_task_type.sql`）
- 单测一律 mock `pool.query`，不连真实 DB（同 `battle-report.test.js`/`scheduler-jobs.test.js` 现有模式）
- 每段数据查询独立 try/catch，单段失败不影响其他段（现有 `battle-report.js` 无此模式但 PrepPRD 要求"军师留痕"等弱关联段容错，本设计明确要求）
- 所有输出中文注释/日志（`console.log`/`console.warn` 前缀 `[line-dreaming]`）

---

### Task 1: Migration 328 — design_docs 加 line_ledger 类型 + journey_id 列

**Files:**
- Create: `packages/brain/migrations/328_design_docs_line_ledger.sql`

**Interfaces:**
- Consumes: 无
- Produces: `design_docs.journey_id UUID`（供 Task 5/6/7/8/9 使用）；`design_docs_type_check` 白名单含 `line_ledger`

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 328: design_docs 加 line_ledger 类型 + journey_id 列
-- dreaming L1：line 级夜间蒸馏 job 落库用。

ALTER TABLE design_docs
  DROP CONSTRAINT IF EXISTS design_docs_type_check;

ALTER TABLE design_docs
  ADD CONSTRAINT design_docs_type_check
    CHECK (type IN (
      'diary',
      'research',
      'architecture',
      'proposal',
      'analysis',
      'meeting',
      'strategy',
      'roadmap',
      'retrospective',
      'idea',
      'context',
      'battle_report',
      'line_ledger'
    ));

ALTER TABLE design_docs
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_design_docs_journey_id
  ON design_docs (journey_id) WHERE journey_id IS NOT NULL;
```

- [ ] **Step 2: 本地应用 migration 验证语法**

Run: `PGPASSWORD=$(grep -o 'password=[^ ]*' packages/brain/.env 2>/dev/null | head -1 | cut -d= -f2) psql -h localhost -U postgres -d cecelia -f packages/brain/migrations/328_design_docs_line_ledger.sql 2>&1 || echo "SKIP: 本地无 DB 连接，语法留给 CI migration 校验"`

Expected: 无 SQL 语法错误报出（若本地无 DB 连接则跳过，交由 CI 的 migration runner 校验）

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/328_design_docs_line_ledger.sql
git commit -m "feat(brain): migration 328 design_docs 加 line_ledger 类型 + journey_id 列"
```

---

### Task 2: line-dreaming.js — 窗口判断 + 去重 + active journeys 查询

**Files:**
- Create: `packages/brain/src/line-dreaming.js`
- Test: `packages/brain/src/__tests__/line-dreaming.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `isInLineDreamingWindow(now: Date): boolean`、`alreadyDreamedToday(pool, journeyId: string): Promise<boolean>`、`getActiveJourneys(pool): Promise<Array<{id:string, name:string}>>`（供 Task 5 使用）

- [ ] **Step 1: 写失败测试**

```javascript
// packages/brain/src/__tests__/line-dreaming.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isInLineDreamingWindow,
  alreadyDreamedToday,
  getActiveJourneys,
} from '../line-dreaming.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isInLineDreamingWindow — UTC 21:00-21:05 = 北京 05:00-05:05', () => {
  it('UTC 20:59 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 20, 59)))).toBe(false);
  });
  it('UTC 21:00 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 0)))).toBe(true);
  });
  it('UTC 21:04 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 4)))).toBe(true);
  });
  it('UTC 21:05 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 5)))).toBe(false);
  });
});

describe('alreadyDreamedToday — 20h 内该 journey 已有 line_ledger → true', () => {
  it('有记录 → true，SQL 含 line_ledger/20 hours/journey_id', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/line_ledger/);
    expect(sql).toMatch(/20 hours/);
    expect(sql).toMatch(/journey_id/);
    expect(params).toEqual(['journey-1']);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(false);
  });
});

describe('getActiveJourneys — 拉 status=active 的 journey', () => {
  it('返回 id+name 列表', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }],
      }),
    };
    const result = await getActiveJourneys(pool);
    expect(result).toEqual([{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'active'/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: FAIL，报 `Cannot find module '../line-dreaming.js'` 或 `isInLineDreamingWindow is not a function`

- [ ] **Step 3: 写最小实现**

```javascript
// packages/brain/src/line-dreaming.js
/**
 * line-dreaming.js — L1 line 级夜间蒸馏 job（dreaming L1）
 *
 * 每晚北京 05:00（UTC 21:00，排在 battle-report 之前）把每条 active line（journey）
 * 的 24h 事实（decisions/journey_features/advancement_items/issues/initiative_runs/
 * learnings/军师留痕）蒸馏成一份 markdown 摘要，落 design_docs(type='line_ledger')。
 * diary / arch_review / strategy_session 三个 L3 文档改为消费这份摘要，不再各自
 * 重新拉一遍 24h 原始切片（口径统一 + 减少重复查询）。
 */

/** 每晚触发小时（UTC）= 北京时间 05:00 */
const LINE_DREAMING_HOUR_UTC = 21;

/**
 * 判断当前是否在夜间蒸馏窗口内（UTC 21:00-21:05 = 北京 05:00-05:05）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInLineDreamingWindow(now = new Date()) {
  return now.getUTCHours() === LINE_DREAMING_HOUR_UTC && now.getUTCMinutes() < 5;
}

/**
 * 该 journey 20h 内是否已有 line_ledger 记录（去重）。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @returns {Promise<boolean>}
 */
export async function alreadyDreamedToday(pool, journeyId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM design_docs
     WHERE type = 'line_ledger'
       AND journey_id = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [journeyId]
  );
  return rows.length > 0;
}

/**
 * 拉所有 active journey（line）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getActiveJourneys(pool) {
  const { rows } = await pool.query(
    `SELECT id, name FROM journeys WHERE status = 'active' ORDER BY name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: PASS（3 个 describe block 全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/line-dreaming.js packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "feat(brain): line-dreaming 窗口判断+去重+active journeys 查询"
```

---

### Task 3: line-dreaming.js — buildLineDreamData 六段 24h 切片

**Files:**
- Modify: `packages/brain/src/line-dreaming.js`
- Test: `packages/brain/src/__tests__/line-dreaming.test.js`

**Interfaces:**
- Consumes: 无（独立查询函数）
- Produces: `buildLineDreamData(pool, journeyId: string, journeyName: string): Promise<{decisions: Array, advancementItems: Array, issues: Array, runs: Array, learnings: Array, strategistNotes: Array}>`（供 Task 4 `renderLineLedgerMarkdown` 使用）

- [ ] **Step 1: 写失败测试**

```javascript
// 追加进 packages/brain/src/__tests__/line-dreaming.test.js
import { buildLineDreamData } from '../line-dreaming.js';

describe('buildLineDreamData — 六段 24h 切片，单段失败不影响其他段', () => {
  it('六段查询各自被调用一次', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await buildLineDreamData(pool, 'journey-1', 'Line A');
    expect(pool.query).toHaveBeenCalledTimes(6);
    const sqls = pool.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /FROM decisions/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM advancement_items/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM issues/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM initiative_runs/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM learnings/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM notes/.test(s))).toBe(true);
  });

  it('单段查询抛错时该段为空数组，不影响其他段', async () => {
    let call = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        call++;
        if (/FROM learnings/.test(sql)) throw new Error('learnings 查询挂了');
        if (/FROM decisions/.test(sql)) return { rows: [{ id: 'd1' }] };
        return { rows: [] };
      }),
    };
    const data = await buildLineDreamData(pool, 'journey-1', 'Line A');
    expect(data.learnings).toEqual([]);
    expect(data.decisions).toEqual([{ id: 'd1' }]);
  });

  it('军师留痕查询按 journeyName 拼接标题前缀', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await buildLineDreamData(pool, 'journey-1', 'Line A');
    const notesCall = pool.query.mock.calls.find((c) => /FROM notes/.test(c[0]));
    expect(notesCall[0]).toMatch(/title LIKE/);
    expect(notesCall[1]).toContain('军师决策[Line A]%');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: FAIL，`buildLineDreamData is not a function`

- [ ] **Step 3: 实现 buildLineDreamData（追加进 line-dreaming.js）**

```javascript
/**
 * 单段查询容错包装：失败返回空数组，不抛出、不阻断其他段。
 * @param {Promise<{rows: Array}>} queryPromise
 * @param {string} label
 * @returns {Promise<Array>}
 */
async function safeRows(queryPromise, label) {
  try {
    const { rows } = await queryPromise;
    return rows;
  } catch (err) {
    console.warn(`[line-dreaming] ${label} 查询失败（该段留空）:`, err.message);
    return [];
  }
}

/**
 * 拉一条 line 的 24h 六段切片：decisions/推进项/issues/runs/learnings/军师留痕。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @returns {Promise<{decisions: Array, advancementItems: Array, issues: Array, runs: Array, learnings: Array, strategistNotes: Array}>}
 */
export async function buildLineDreamData(pool, journeyId, journeyName) {
  const [decisions, advancementItems, issues, runs, learnings, strategistNotes] = await Promise.all([
    safeRows(
      pool.query(
        `SELECT d.id, d.topic, d.decision, d.created_at
         FROM decisions d
         JOIN journey_features jf ON d.target_id = jf.id
         WHERE d.target_type = 'journey_feature'
           AND jf.journey_id = $1
           AND d.created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY d.created_at DESC`,
        [journeyId]
      ),
      'decisions'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, status, priority, updated_at
         FROM advancement_items
         WHERE journey_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC`,
        [journeyId]
      ),
      'advancement_items'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, priority, status, updated_at
         FROM issues
         WHERE journey_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC`,
        [journeyId]
      ),
      'issues'
    ),
    safeRows(
      pool.query(
        `SELECT id, phase, failure_reason, created_at
         FROM initiative_runs
         WHERE journey_id = $1
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC`,
        [journeyId]
      ),
      'initiative_runs'
    ),
    safeRows(
      pool.query(
        `SELECT l.id, l.content, l.created_at
         FROM learnings l
         JOIN tasks t ON l.task_id = t.id
         WHERE t.payload->>'journey_id' = $1
           AND l.created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY l.created_at DESC`,
        [journeyId]
      ),
      'learnings'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, content, created_at
         FROM notes
         WHERE title LIKE $1
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC`,
        [`军师决策[${journeyName}]%`]
      ),
      'strategist_notes'
    ),
  ]);

  return { decisions, advancementItems, issues, runs, learnings, strategistNotes };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: PASS 全部 describe block

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/line-dreaming.js packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "feat(brain): line-dreaming buildLineDreamData 六段24h切片(单段容错)"
```

---

### Task 4: line-dreaming.js — renderLineLedgerMarkdown

**Files:**
- Modify: `packages/brain/src/line-dreaming.js`
- Test: `packages/brain/src/__tests__/line-dreaming.test.js`

**Interfaces:**
- Consumes: `buildLineDreamData` 的返回值形状 `{decisions, advancementItems, issues, runs, learnings, strategistNotes}`
- Produces: `renderLineLedgerMarkdown(journeyName: string, data): string`（供 Task 5 `upsertLineLedger` 使用）

- [ ] **Step 1: 写失败测试**

```javascript
// 追加进 packages/brain/src/__tests__/line-dreaming.test.js
import { renderLineLedgerMarkdown } from '../line-dreaming.js';

describe('renderLineLedgerMarkdown — 空段渲染"暂无"，有数据渲染条目', () => {
  it('全空 → 每段都是"暂无"', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
    expect(md).toContain('# Line A — 24h 账本');
    expect(md).toContain('## 决策');
    expect((md.match(/暂无/g) || []).length).toBe(6);
  });

  it('有决策数据 → 渲染 topic', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [{ id: 'd1', topic: '铁律X', decision: '决定Y', created_at: '2026-07-10T00:00:00Z' }],
      advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
    expect(md).toContain('铁律X');
    expect(md).toContain('决定Y');
  });

  it('有军师留痕 → 渲染 title', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [],
      strategistNotes: [{ id: 'n1', title: '军师决策[Line A]: 挑下一个推进项', created_at: '2026-07-10T00:00:00Z' }],
    });
    expect(md).toContain('军师决策[Line A]: 挑下一个推进项');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: FAIL，`renderLineLedgerMarkdown is not a function`

- [ ] **Step 3: 实现（追加进 line-dreaming.js）**

```javascript
/**
 * 渲染一个数据段为 markdown 列表；空数组渲染"暂无"。
 * @param {Array<object>} rows
 * @param {(row: object) => string} formatter
 * @returns {string[]}
 */
function renderSection(rows, formatter) {
  if (rows.length === 0) return ['暂无'];
  return rows.map(formatter);
}

/**
 * 渲染 line_ledger 的 markdown 摘要（六段，空段"暂无"）。
 * @param {string} journeyName
 * @param {{decisions: Array, advancementItems: Array, issues: Array, runs: Array, learnings: Array, strategistNotes: Array}} data
 * @returns {string}
 */
export function renderLineLedgerMarkdown(journeyName, data) {
  const lines = [`# ${journeyName} — 24h 账本`, ''];

  lines.push('## 决策');
  lines.push(...renderSection(data.decisions, (d) => `- ${d.topic ?? '(无主题)'}：${d.decision ?? ''}`));
  lines.push('');

  lines.push('## 推进项变化');
  lines.push(...renderSection(data.advancementItems, (a) => `- ${a.title ?? '(无标题)'}（${a.status ?? '?'}）`));
  lines.push('');

  lines.push('## Issue 变化');
  lines.push(...renderSection(data.issues, (i) => `- [${i.priority ?? '?'}] ${i.title ?? '(无标题)'}（${i.status ?? '?'}）`));
  lines.push('');

  lines.push('## Run 战况');
  lines.push(...renderSection(data.runs, (r) => `- phase=${r.phase ?? '?'}${r.failure_reason ? `，失败原因：${r.failure_reason}` : ''}`));
  lines.push('');

  lines.push('## Learnings');
  lines.push(...renderSection(data.learnings, (l) => `- ${(l.content ?? '').slice(0, 100)}`));
  lines.push('');

  lines.push('## 军师留痕');
  lines.push(...renderSection(data.strategistNotes, (n) => `- ${n.title ?? '(无标题)'}`));
  lines.push('');

  return lines.join('\n');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/line-dreaming.js packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "feat(brain): line-dreaming renderLineLedgerMarkdown 六段markdown渲染"
```

---

### Task 5: line-dreaming.js — upsertLineLedger + generateLineLedger + maybeRunLineDreaming

**Files:**
- Modify: `packages/brain/src/line-dreaming.js`
- Test: `packages/brain/src/__tests__/line-dreaming.test.js`

**Interfaces:**
- Consumes: `isInLineDreamingWindow`、`alreadyDreamedToday`、`getActiveJourneys`（Task 2）、`buildLineDreamData`（Task 3）、`renderLineLedgerMarkdown`（Task 4）
- Produces: `upsertLineLedger(pool, journeyId, journeyName, markdown): Promise<void>`、`generateLineLedger(pool, journeyId, journeyName): Promise<void>`、`maybeRunLineDreaming(pool, now?): Promise<{triggered: boolean, dreamed: number, skipped: number, failed: number}>`（供 Task 6 `scheduler-jobs.js` 注册使用）

- [ ] **Step 1: 写失败测试**

```javascript
// 追加进 packages/brain/src/__tests__/line-dreaming.test.js
import { upsertLineLedger, generateLineLedger, maybeRunLineDreaming } from '../line-dreaming.js';

describe('upsertLineLedger — 20h 内存在则 UPDATE，否则 INSERT', () => {
  it('存在近期记录 → UPDATE', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT id FROM design_docs/.test(sql)) return { rows: [{ id: 'doc-1' }] };
        return { rows: [] };
      }),
    };
    await upsertLineLedger(pool, 'journey-1', 'Line A', '# content');
    const updateCall = pool.query.mock.calls.find((c) => /UPDATE design_docs/.test(c[0]));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('doc-1');
  });

  it('不存在 → INSERT', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await upsertLineLedger(pool, 'journey-1', 'Line A', '# content');
    const insertCall = pool.query.mock.calls.find((c) => /INSERT INTO design_docs/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[0]).toMatch(/line_ledger/);
  });
});

describe('maybeRunLineDreaming — 非窗口期不执行；窗口期遍历 active journeys', () => {
  it('非窗口期 → triggered=false', async () => {
    const pool = { query: vi.fn() };
    const result = await maybeRunLineDreaming(pool, new Date(Date.UTC(2026, 6, 10, 10, 0)));
    expect(result.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('窗口期 → 遍历 active journeys，单条失败不阻断其他 journey', async () => {
    let journeyCall = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM journeys WHERE status/.test(sql)) {
          return { rows: [{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }] };
        }
        if (/type = 'line_ledger'.*journey_id = \$1/s.test(sql)) {
          journeyCall++;
          if (journeyCall === 1) throw new Error('j1 去重检查挂了');
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    const result = await maybeRunLineDreaming(pool, new Date(Date.UTC(2026, 6, 10, 21, 0)));
    expect(result.triggered).toBe(true);
    expect(result.failed).toBe(1);
    expect(result.dreamed).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: FAIL，三个新函数未定义

- [ ] **Step 3: 实现（追加进 line-dreaming.js）**

```javascript
/**
 * 落库：20h 内该 journey 已有记录则 UPDATE，否则 INSERT。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @param {string} markdown
 * @returns {Promise<void>}
 */
export async function upsertLineLedger(pool, journeyId, journeyName, markdown) {
  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'line_ledger' AND journey_id = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [journeyId]
  );

  if (rows.length > 0) {
    await pool.query(
      `UPDATE design_docs SET content = $2, updated_at = NOW() WHERE id = $1`,
      [rows[0].id, markdown]
    );
    return;
  }

  await pool.query(
    `INSERT INTO design_docs (type, title, content, journey_id, author)
     VALUES ('line_ledger', $1, $2, $3, 'cecelia')`,
    [`${journeyName} — 24h 账本`, markdown, journeyId]
  );
}

/**
 * 组合：拉切片 → 渲染 → 落库。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @returns {Promise<void>}
 */
export async function generateLineLedger(pool, journeyId, journeyName) {
  const data = await buildLineDreamData(pool, journeyId, journeyName);
  const markdown = renderLineLedgerMarkdown(journeyName, data);
  await upsertLineLedger(pool, journeyId, journeyName, markdown);
}

/**
 * 夜间蒸馏主入口：窗口内遍历所有 active journey，逐条去重+生成，单条失败不影响其他 journey。
 * @param {import('pg').Pool} pool
 * @param {Date} [now]
 * @returns {Promise<{triggered: boolean, dreamed: number, skipped: number, failed: number}>}
 */
export async function maybeRunLineDreaming(pool, now = new Date()) {
  if (!isInLineDreamingWindow(now)) {
    return { triggered: false, dreamed: 0, skipped: 0, failed: 0 };
  }

  const journeys = await getActiveJourneys(pool);
  let dreamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const journey of journeys) {
    try {
      const already = await alreadyDreamedToday(pool, journey.id);
      if (already) {
        skipped++;
        continue;
      }
      await generateLineLedger(pool, journey.id, journey.name);
      dreamed++;
    } catch (err) {
      console.warn(`[line-dreaming] journey ${journey.id} 蒸馏失败（跳过）:`, err.message);
      failed++;
    }
  }

  return { triggered: true, dreamed, skipped, failed };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: PASS 全部

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/line-dreaming.js packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "feat(brain): line-dreaming upsertLineLedger+generateLineLedger+maybeRunLineDreaming"
```

---

### Task 6: scheduler-jobs.js 注册 line-dreaming（排在 battle-report 前）

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`
- Test: `packages/brain/src/__tests__/scheduler-jobs.test.js`

**Interfaces:**
- Consumes: `maybeRunLineDreaming` from `./line-dreaming.js`（Task 5）
- Produces: `JOBS` 数组新增一条 `{name: 'line-dreaming', ...}`，位置在 `battle-report` 之前

- [ ] **Step 1: 读现有测试确认断言方式**

Run: `cd packages/brain && grep -n "JOBS\[" src/__tests__/scheduler-jobs.test.js | head -5`
Expected: 看到现有测试如何断言 JOBS 数组内容/顺序（用于写新断言时保持风格一致）

- [ ] **Step 2: 写失败测试（追加进 scheduler-jobs.test.js）**

```javascript
// 追加进 packages/brain/src/__tests__/scheduler-jobs.test.js
import { JOBS } from '../scheduler-jobs.js';

describe('line-dreaming job 注册', () => {
  it('JOBS 里存在 line-dreaming，且排在 battle-report 之前', () => {
    const dreamIdx = JOBS.findIndex((j) => j.name === 'line-dreaming');
    const reportIdx = JOBS.findIndex((j) => j.name === 'battle-report');
    expect(dreamIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(dreamIdx).toBeLessThan(reportIdx);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js -t "line-dreaming"`
Expected: FAIL，`dreamIdx` 为 -1

- [ ] **Step 4: 修改 scheduler-jobs.js**

在 `import { maybeGenerateBattleReport } from './battle-report.js';` 之后新增一行 import，并在 `JOBS` 数组中 `battle-report` 条目之前插入新条目：

```javascript
import { maybeRunLineDreaming } from './line-dreaming.js';
```

```javascript
  { name: 'line-dreaming', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunLineDreaming, description: 'L1 line 级夜间蒸馏（自带北京05:00窗口+20h去重，晨报前跑完）' },
  { name: 'battle-report', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeGenerateBattleReport, description: '作战日报（北京06:00窗口+当日去重自 gate）' },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: PASS 全部（含既有测试不回归）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "feat(brain): scheduler-jobs 注册 line-dreaming（排在 battle-report 前）"
```

---

### Task 7: diary-scheduler.js 消费 line_ledger 摘要

**Files:**
- Modify: `packages/brain/src/diary-scheduler.js`
- Test: `packages/brain/src/__tests__/diary-scheduler.test.js`

**Interfaces:**
- Consumes: `design_docs(type='line_ledger', created_at>=NOW()-20h)`
- Produces: `fetchLineLedgersSummary(pool): Promise<Array<{title: string, content: string}>>`；`buildDiaryContent` 新增可选段落"各线动态"

- [ ] **Step 1: 写失败测试（追加进 diary-scheduler.test.js；若该测试文件不存在则先看现有测试文件名）**

Run: `cd packages/brain && ls src/__tests__/ | grep diary`
Expected: 确认现有测试文件名（若不存在则新建 `packages/brain/src/__tests__/diary-scheduler.test.js`，import 现有 `buildDiaryContent`/`fetchKRProgress` 等已导出函数验证不回归）

```javascript
// 追加/新建 packages/brain/src/__tests__/diary-scheduler.test.js 相关 describe block
import { describe, it, expect, vi } from 'vitest';
import { fetchLineLedgersSummary, buildDiaryContent } from '../diary-scheduler.js';

describe('fetchLineLedgersSummary — 拉 20h 内所有 line_ledger', () => {
  it('SQL 含 line_ledger/20 hours', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ title: 'Line A — 24h 账本', content: '# ...' }] }) };
    const result = await fetchLineLedgersSummary(pool);
    expect(result).toEqual([{ title: 'Line A — 24h 账本', content: '# ...' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/line_ledger/);
    expect(sql).toMatch(/20 hours/);
  });
});

describe('buildDiaryContent — 各线动态段落', () => {
  it('lineLedgers 为空 → "暂无各线动态"', () => {
    const content = buildDiaryContent({
      today: '2026-07-10', prs: 0, decisions: 0, completedTasks: 0, krProgress: [], failedTasks: 0, lineLedgers: [],
    });
    expect(content).toContain('## 各线动态');
    expect(content).toContain('暂无各线动态');
  });

  it('lineLedgers 有数据 → 渲染 title', () => {
    const content = buildDiaryContent({
      today: '2026-07-10', prs: 0, decisions: 0, completedTasks: 0, krProgress: [], failedTasks: 0,
      lineLedgers: [{ title: 'Line A — 24h 账本', content: '摘要内容' }],
    });
    expect(content).toContain('Line A — 24h 账本');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/diary-scheduler.test.js`
Expected: FAIL，`fetchLineLedgersSummary is not a function`

- [ ] **Step 3: 修改 diary-scheduler.js**

在 `fetchTodayFailedTasks` 之后新增：

```javascript
/**
 * 拉 20h 内所有 line_ledger 摘要（L1 dreaming job 产出），供日报"各线动态"段落使用。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{title: string, content: string}>>}
 */
export async function fetchLineLedgersSummary(pool) {
  const { rows } = await pool.query(
    `SELECT title, content FROM design_docs
     WHERE type = 'line_ledger' AND created_at >= NOW() - INTERVAL '20 hours'
     ORDER BY title`
  );
  return rows;
}
```

修改 `buildDiaryContent` 签名，新增 `lineLedgers = []` 参数，并在"KR 进度"段落之后、"异常告警"段落之前插入新段落：

```javascript
export function buildDiaryContent({ today, prs, decisions, completedTasks, krProgress = [], failedTasks = 0, lineLedgers = [] }) {
```

```javascript
  // ── 各线动态 ────────────────────────────────────────────────────────────
  lines.push('## 各线动态');
  lines.push('');
  if (lineLedgers.length === 0) {
    lines.push('暂无各线动态');
  } else {
    for (const ledger of lineLedgers) {
      lines.push(`### ${ledger.title}`);
      lines.push(ledger.content);
      lines.push('');
    }
  }
  lines.push('');
```

（插入位置：紧接现有 `lines.push('');`（KR 进度段落结束后）、`lines.push('## 异常告警');` 之前）

修改 `generateDailyDiaryIfNeeded` 里 `Promise.all` 新增一路查询，并把结果传进 `stats`：

```javascript
    const [prsResult, decisionsResult, tasksResult, krProgress, failedTasks, lineLedgers] = await Promise.all([
      pool.query(
        `SELECT count(*) FROM dev_records WHERE merged_at::date = $1`,
        [today]
      ),
      pool.query(
        `SELECT count(*) FROM decisions WHERE created_at::date = $1`,
        [today]
      ),
      pool.query(
        `SELECT count(*) FROM tasks WHERE completed_at::date = $1`,
        [today]
      ),
      fetchKRProgress(pool),
      fetchTodayFailedTasks(pool, today),
      fetchLineLedgersSummary(pool),
    ]);

    const stats = {
      today,
      prs: parseInt(prsResult.rows[0].count),
      decisions: parseInt(decisionsResult.rows[0].count),
      completedTasks: parseInt(tasksResult.rows[0].count),
      krProgress,
      failedTasks,
      lineLedgers,
    };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/diary-scheduler.test.js`
Expected: PASS 全部（含已有测试不回归——运行整个文件确认无 regression）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/diary-scheduler.js packages/brain/src/__tests__/diary-scheduler.test.js
git commit -m "feat(brain): diary-scheduler 新增各线动态段落(消费 line_ledger)"
```

---

### Task 8: daily-review-scheduler.js — triggerArchReview 注入 line_ledger 上下文

**Files:**
- Modify: `packages/brain/src/daily-review-scheduler.js`
- Test: `packages/brain/src/__tests__/daily-review-scheduler.test.js`（若不存在按现有测试目录约定新建，import 方式同 Task 7）

**Interfaces:**
- Consumes: `design_docs(type='line_ledger', created_at>=NOW()-20h)` 全量拼接
- Produces: `fetchAllLineLedgersDigest(pool): Promise<string>`；`triggerArchReview` 生成的 task `payload.prd_summary` 追加 line_ledger 摘要段

- [ ] **Step 1: 写失败测试**

Run: `cd packages/brain && ls src/__tests__/ | grep daily-review`

```javascript
// 追加/新建 packages/brain/src/__tests__/daily-review-scheduler.test.js 相关部分
import { describe, it, expect, vi } from 'vitest';
import { fetchAllLineLedgersDigest } from '../daily-review-scheduler.js';

describe('fetchAllLineLedgersDigest — 拼接所有 line_ledger 为一段摘要', () => {
  it('无记录 → 空串', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(fetchAllLineLedgersDigest(pool)).resolves.toBe('');
  });

  it('有记录 → 拼接 title+content', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ title: 'Line A — 24h 账本', content: '摘要A' }, { title: 'Line B — 24h 账本', content: '摘要B' }],
      }),
    };
    const digest = await fetchAllLineLedgersDigest(pool);
    expect(digest).toContain('Line A — 24h 账本');
    expect(digest).toContain('摘要A');
    expect(digest).toContain('Line B — 24h 账本');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/daily-review-scheduler.test.js -t "fetchAllLineLedgersDigest"`
Expected: FAIL，函数未定义

- [ ] **Step 3: 修改 daily-review-scheduler.js**

在文件顶部（`getActiveRepoPaths` 之后）新增：

```javascript
/**
 * 拉 20h 内所有 line_ledger，拼成一段纯文本摘要（供 arch_review/strategy_session
 * 任务的 prd_summary 注入，替代各自重新调研 24h 事实）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function fetchAllLineLedgersDigest(pool) {
  const { rows } = await pool.query(
    `SELECT title, content FROM design_docs
     WHERE type = 'line_ledger' AND created_at >= NOW() - INTERVAL '20 hours'
     ORDER BY title`
  );
  if (rows.length === 0) return '';
  return rows.map((r) => `### ${r.title}\n${r.content}`).join('\n\n');
}
```

修改 `triggerArchReview` 里建任务前的 `prd_summary` 拼接，插入 digest（找到 Step 4 里 `INSERT INTO tasks` 前的代码块）：

```javascript
  try {
    const timestamp = now.toISOString().slice(0, 16).replace('T', ' ');
    const lineLedgerDigest = await fetchAllLineLedgersDigest(pool).catch(() => '');
    const prdSummary = lineLedgerDigest
      ? `架构巡检：扫描 ${timestamp} UTC 时点的 drift / 未收敛模式 / 依赖异常，输出 4A/4B 报告供复盘。\n\n## 各线 24h 账本（line_ledger 摘要）\n${lineLedgerDigest}`
      : `架构巡检：扫描 ${timestamp} UTC 时点的 drift / 未收敛模式 / 依赖异常，输出 4A/4B 报告供复盘。`;
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, created_by, payload, trigger_source, location)
       VALUES ($1, 'arch_review', 'queued', 'P2', 'cecelia-brain', $2, 'brain_auto', 'xian')
       RETURNING id`,
      [
        `[arch-review] 定时架构巡检 ${timestamp} UTC`,
        JSON.stringify({
          scope: 'scheduled',
          trigger: '4h',
          prd_summary: prdSummary,
        }),
      ]
    );
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/daily-review-scheduler.test.js`
Expected: PASS 全部（含已有测试不回归）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/daily-review-scheduler.js packages/brain/src/__tests__/daily-review-scheduler.test.js
git commit -m "feat(brain): triggerArchReview 注入 line_ledger 全线摘要"
```

---

### Task 9: active-goals-zero-trigger.js — maybeTriggerStrategySession 注入 line_ledger 上下文

**Files:**
- Modify: `packages/brain/src/active-goals-zero-trigger.js`
- Test: `packages/brain/src/__tests__/active-goals-zero-trigger.test.js`（若不存在按 Task 8 方式新建）

**Interfaces:**
- Consumes: `fetchAllLineLedgersDigest` from `./daily-review-scheduler.js`（Task 8）
- Produces: `maybeTriggerStrategySession` 生成的 task `payload.line_context` 字段

- [ ] **Step 1: 写失败测试**

Run: `cd packages/brain && ls src/__tests__/ | grep active-goals`

```javascript
// 追加/新建 packages/brain/src/__tests__/active-goals-zero-trigger.test.js 相关部分
import { describe, it, expect, vi } from 'vitest';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';

describe('maybeTriggerStrategySession — payload 携带 line_context', () => {
  it('active_goals=0 时建任务，payload.line_context 来自 line_ledger digest', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM objectives/.test(sql)) return { rows: [{ cnt: '0' }] };
        if (/task_type = 'strategy_session'/.test(sql)) return { rows: [] };
        if (/FROM design_docs/.test(sql)) return { rows: [{ title: 'Line A — 24h 账本', content: '摘要A' }] };
        if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 'task-1' }] };
        return { rows: [] };
      }),
    };
    await maybeTriggerStrategySession(pool);
    const insertCall = pool.query.mock.calls.find((c) => /INSERT INTO tasks/.test(c[0]));
    const payload = JSON.parse(insertCall[1][2]);
    expect(payload.line_context).toContain('Line A — 24h 账本');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/active-goals-zero-trigger.test.js -t "line_context"`
Expected: FAIL，`payload.line_context` 为 `undefined`

- [ ] **Step 3: 修改 active-goals-zero-trigger.js**

在文件顶部新增 import：

```javascript
import { fetchAllLineLedgersDigest } from './daily-review-scheduler.js';
```

修改 `insertResult` 之前，拉 digest 并放进 payload（原第 60-66 行附近的 INSERT 调用改为）：

```javascript
  const lineContext = await fetchAllLineLedgersDigest(pool).catch(() => '');

  const insertResult = await pool.query(`
    INSERT INTO tasks (title, description, status, priority, task_type, payload, trigger_source)
    VALUES ($1, $2, 'queued', 'P0', 'strategy_session', $3, 'active_goals_zero')
    RETURNING id
  `, [
    'active_goals=0 自救：召开战略会议生成新 OKR',
    '检测到当前无活跃 OKR，自动触发战略会议流程生成新的季度目标。',
    JSON.stringify({ trigger: 'active_goals_zero', line_context: lineContext }),
  ]);
```

（注意：原代码此处第三个 SQL 参数的具体现有取值需先 `grep -n "insertResult" -A 15 packages/brain/src/active-goals-zero-trigger.js` 确认现有 `payload` 字段结构，若已有其他字段则在其基础上新增 `line_context` 键，不覆盖已有字段）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/active-goals-zero-trigger.test.js`
Expected: PASS 全部（含已有测试不回归）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/active-goals-zero-trigger.js packages/brain/src/__tests__/active-goals-zero-trigger.test.js
git commit -m "feat(brain): maybeTriggerStrategySession payload 注入 line_ledger 全线摘要"
```

---

### Task 10: 全量回归 + DevGate

**Files:**
- 无新文件；跑全量校验

- [ ] **Step 1: 跑受影响模块全量单测**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/diary-scheduler.test.js src/__tests__/daily-review-scheduler.test.js src/__tests__/active-goals-zero-trigger.test.js src/__tests__/battle-report.test.js`
Expected: 全部 PASS，无 regression

- [ ] **Step 2: DevGate 三件套**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs`
Expected: 三条命令全部 exit 0（本任务未改动 `packages/brain` 版本号/事实性文档，正常应直接通过；若报版本不同步，按 `version-management.md` 补 5 文件 bump）

- [ ] **Step 3: Commit（若 Step 2 有修复）**

```bash
git add -A
git commit -m "chore(brain): devgate 校验修复"
```

---

## Self-Review Notes（写计划时已核对）

- **Spec coverage**：PrepPRD 四点（①job 注册 ②六段切片 ③line_ledger 落库 ④三文档消费）分别对应 Task 1/2-3/4-5/6（job）与 Task 7/8/9（三文档）；测试策略段（unit mock pool 全覆盖）对应每个 Task 的 Step 1-4。
- **Type consistency**：`buildLineDreamData` 返回的键名 `{decisions, advancementItems, issues, runs, learnings, strategistNotes}` 在 Task 4 `renderLineLedgerMarkdown` 与 Task 3 测试中保持一致；`upsertLineLedger(pool, journeyId, journeyName, markdown)` 参数顺序在 Task 5 定义与 Task 5 `generateLineLedger` 调用处一致。
- **已知不确定点（实现时需现场确认，已在对应 Task 里标注 grep 命令）**：`active-goals-zero-trigger.js` 现有 `payload` 字段结构（Task 9 Step 3 已标注需先 grep 确认，避免覆盖已有字段）；`diary-scheduler.test.js`/`daily-review-scheduler.test.js`/`active-goals-zero-trigger.test.js` 是否已存在（Task 7/8/9 Step 1 已标注先 `ls` 确认，不存在则新建）。
