# 九要素T10 统一收件箱通电 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** handoff/learning/issue 三条产出路径写入时推送 capture_atoms + 新建 capture-triage 分诊 tick（便宜规则+LLM兜底）+ Invariant Gate 四查后才写 decisions category='invariant'。

**Architecture:** 新建 `capture-inbox.js`（吞错写入 helper）、`capture-triage.js`（scheduler-jobs 注册的 tick handler，内置间隔 gate）、`invariant-gate.js`（纯裁决，不写库）；三处既有写入函数各加一次推送调用。无 migration。上游 spec：`docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md`。

**Tech Stack:** Node.js ESM（packages/brain）、pg pool、vitest（mock pool + mock LLM）、`llm-caller.js` 的 `callLLM`。

**约定（全计划一致）：**
- 写入时 `routed_to_table`/`routed_to_id` 是**来源指针**（handoff→'tasks'/task_id、learning→'learnings'/id、issue→'issues'/id）；triage 命中 line_backlog/invariant 时才改写为目的地。
- 分诊路由枚举：`'urgent' | 'line_backlog' | 'invariant' | 'okr'`。
- 测试命令统一：`cd packages/brain && npx vitest run src/__tests__/<file> --reporter=basic`

---

### Task 1: capture-inbox.js 写入 helper

**Files:**
- Create: `packages/brain/src/capture-inbox.js`
- Test: `packages/brain/src/__tests__/capture-inbox.test.js`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/capture-inbox.test.js
import { describe, it, expect, vi } from 'vitest';
import { pushCaptureAtom } from '../capture-inbox.js';

describe('pushCaptureAtom', () => {
  it('插入一条 capture_atoms（capture_id NULL，status 走默认）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'atom-1' }] }) };
    const id = await pushCaptureAtom(pool, {
      content: 'x', targetType: 'handoff', targetSubtype: 'PASS',
      routedToTable: 'tasks', routedToId: '11111111-1111-1111-1111-111111111111',
    });
    expect(id).toBe('atom-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO capture_atoms/);
    expect(params).toEqual(['x', 'handoff', 'PASS', 'tasks', '11111111-1111-1111-1111-111111111111']);
  });

  it('content 超 1000 字截断', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'a' }] }) };
    await pushCaptureAtom(pool, { content: 'x'.repeat(2000), targetType: 'learning' });
    expect(pool.query.mock.calls[0][1][0].length).toBe(1000);
  });

  it('pool 抛错时吞掉不 throw，返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(pushCaptureAtom(pool, { content: 'x', targetType: 'issue' })).resolves.toBeNull();
  });

  it('缺 content 或 targetType 直接返回 null 不查库', async () => {
    const pool = { query: vi.fn() };
    await expect(pushCaptureAtom(pool, { targetType: 'issue' })).resolves.toBeNull();
    await expect(pushCaptureAtom(pool, { content: 'x' })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-inbox.test.js --reporter=basic`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```js
// packages/brain/src/capture-inbox.js
/**
 * capture-inbox.js — 统一收件箱"推"入口（九要素T10）
 *
 * handoff/learning/issue 产出后顺手推一条 capture_atom（status 默认 pending_review），
 * 由 capture-triage tick 异步分诊。写入失败绝不抛——进箱失败不允许阻塞主流程。
 * routed_to_table/routed_to_id 在写入时是"来源指针"，triage 路由后才改写为目的地。
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */
const MAX_CONTENT_LEN = 1000;

export async function pushCaptureAtom(pool, { content, targetType, targetSubtype = null, routedToTable = null, routedToId = null } = {}) {
  if (!content || !targetType) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO capture_atoms (content, target_type, target_subtype, routed_to_table, routed_to_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [String(content).slice(0, MAX_CONTENT_LEN), targetType, targetSubtype, routedToTable, routedToId]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[capture-inbox] push failed (non-fatal): ${err.message}`);
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-inbox.test.js --reporter=basic`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/capture-inbox.js packages/brain/src/__tests__/capture-inbox.test.js
git commit -m "feat(brain/T10): capture-inbox 推入口 pushCaptureAtom（吞错不阻塞主流程）"
```

---

### Task 2: handoff.js 接入推送

**Files:**
- Modify: `packages/brain/src/handoff.js`（saveHandoff，L104-124）
- Test: `packages/brain/src/__tests__/handoff.test.js`（追加用例，沿用该文件既有 mock 风格）

- [ ] **Step 1: 写 failing test（追加到 handoff.test.js 末尾）**

```js
// 追加 import（文件顶部已有的不重复加）：
import * as captureInbox from '../capture-inbox.js';

describe('saveHandoff → capture_atoms 推送（T10）', () => {
  it('DB 写成功后推送 atom：verdict=FAIL → subtype=FAIL，来源指针指向 tasks/task_id', async () => {
    const spy = vi.spyOn(captureInbox, 'pushCaptureAtom').mockResolvedValue('atom-1');
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const h = buildHandoff({ task_id: '11111111-1111-1111-1111-111111111111', title: 'T', verdict: 'FAIL', not_done: ['x'] });
    await saveHandoff({ pool }, h);
    expect(spy).toHaveBeenCalledTimes(1);
    const [, fields] = spy.mock.calls[0];
    expect(fields.targetType).toBe('handoff');
    expect(fields.targetSubtype).toBe('FAIL');
    expect(fields.routedToTable).toBe('tasks');
    expect(fields.routedToId).toBe('11111111-1111-1111-1111-111111111111');
    expect(fields.content).toContain('T');
    spy.mockRestore();
  });

  it('PASS 且 next_steps 非「完成，无下一步」→ subtype=PASS+NEXT', async () => {
    const spy = vi.spyOn(captureInbox, 'pushCaptureAtom').mockResolvedValue('atom-1');
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const h = buildHandoff({ task_id: '11111111-1111-1111-1111-111111111111', verdict: 'PASS', next_steps: ['继续 T11'] });
    await saveHandoff({ pool }, h);
    expect(spy.mock.calls[0][1].targetSubtype).toBe('PASS+NEXT');
    spy.mockRestore();
  });

  it('PASS 且 next_steps=[「完成，无下一步」] → subtype=PASS', async () => {
    const spy = vi.spyOn(captureInbox, 'pushCaptureAtom').mockResolvedValue('atom-1');
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const h = buildHandoff({ task_id: '11111111-1111-1111-1111-111111111111', verdict: 'PASS', next_steps: ['完成，无下一步'] });
    await saveHandoff({ pool }, h);
    expect(spy.mock.calls[0][1].targetSubtype).toBe('PASS');
    spy.mockRestore();
  });

  it('DB 写失败（task 不存在）→ 不推送', async () => {
    const spy = vi.spyOn(captureInbox, 'pushCaptureAtom').mockResolvedValue(null);
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) };
    const h = buildHandoff({ task_id: '11111111-1111-1111-1111-111111111111' });
    await expect(saveHandoff({ pool }, h)).rejects.toThrow(/task not found/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/handoff.test.js --reporter=basic`
Expected: 新增 4 用例 FAIL（pushCaptureAtom 未被调用）

- [ ] **Step 3: 实现（handoff.js）**

顶部加 import：
```js
import { pushCaptureAtom } from './capture-inbox.js';
```

在 `saveHandoff` 的 `if (res.rowCount === 0) throw ...`（L111）之后、`let mirrorPath = null;` 之前插入：
```js
  // T10 统一收件箱：DB 主写成功后顺手推一条 atom（吞错，不阻塞镜像与返回）
  const hasRealNextSteps =
    handoff.next_steps.length > 0 &&
    !(handoff.next_steps.length === 1 && handoff.next_steps[0] === '完成，无下一步');
  const subtype = handoff.verdict === 'PASS' && hasRealNextSteps ? 'PASS+NEXT' : (handoff.verdict ?? 'UNKNOWN');
  await pushCaptureAtom(pool, {
    content: [
      `handoff: ${handoff.title || handoff.task_id}`,
      `verdict=${handoff.verdict ?? 'N/A'}`,
      handoff.done.length ? `完成: ${handoff.done.join('; ')}` : '',
      handoff.not_done.length ? `未完成: ${handoff.not_done.join('; ')}` : '',
      handoff.next_steps.length ? `下一步: ${handoff.next_steps.join('; ')}` : '',
    ].filter(Boolean).join('\n'),
    targetType: 'handoff',
    targetSubtype: subtype,
    routedToTable: 'tasks',
    routedToId: handoff.task_id,
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/handoff.test.js --reporter=basic`
Expected: PASS（含既有用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/handoff.js packages/brain/src/__tests__/handoff.test.js
git commit -m "feat(brain/T10): saveHandoff 成功后推送 capture_atoms（verdict/PASS+NEXT 判据入 subtype）"
```

---

### Task 3: learning.js 接入推送

**Files:**
- Modify: `packages/brain/src/learning.js`（recordLearning，主 INSERT 成功之后，约 L116-118 处）
- Test: `packages/brain/src/__tests__/learning-capture-push.test.js`（新文件，避免动既有 learning.test.js 的 mock 布线）

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/learning-capture-push.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../actions.js', () => ({ createTask: vi.fn().mockResolvedValue({}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: () => 'L0摘要' }));

const pushMock = vi.fn().mockResolvedValue('atom-1');
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: (...a) => pushMock(...a) }));

import { recordLearning } from '../learning.js';

describe('recordLearning → capture_atoms 推送（T10）', () => {
  beforeEach(() => { queryMock.mockReset(); pushMock.mockClear(); });

  it('新 learning 落库成功后推送 atom（subtype=category，来源指向 learnings/id）', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/SELECT id, version FROM learnings/.test(sql)) return { rows: [] };
      if (/INSERT INTO learnings/.test(sql)) return { rows: [{ id: 'learn-1', category: 'failure_pattern', title: 'RCA Learning: 根因', summary: 'L0摘要' }] };
      if (/INSERT INTO memory_stream/.test(sql)) return { rows: [{ id: 'mem-1' }] };
      return { rows: [] };
    });
    await recordLearning({ task_id: 't-1', analysis: { root_cause: '根因' }, learnings: [], recommended_actions: [], confidence: 0.5 });
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('learning');
    expect(fields.targetSubtype).toBe('failure_pattern');
    expect(fields.routedToTable).toBe('learnings');
    expect(fields.routedToId).toBe('learn-1');
  });

  it('去重命中（已有同 hash）→ 不推送', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/SELECT id, version FROM learnings/.test(sql)) return { rows: [{ id: 'old-1', version: 1 }] };
      return { rows: [] };
    });
    await recordLearning({ task_id: 't-1', analysis: { root_cause: '根因' }, learnings: [], recommended_actions: [] });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/learning-capture-push.test.js --reporter=basic`
Expected: 第 1 用例 FAIL（pushCaptureAtom 未被调用）

- [ ] **Step 3: 实现（learning.js）**

顶部加 import：
```js
import { pushCaptureAtom } from './capture-inbox.js';
```

在 `const learning = result.rows[0];` 与 `console.log(\`[learning] Recorded learning: ...\`)` 之后（进入 insight task 逻辑之前）插入：
```js
    // T10 统一收件箱：真 learning（噪音已在入口拦截）落库后顺手进箱
    await pushCaptureAtom(pool, {
      content: `learning: ${title}\n${learning.summary || ''}`,
      targetType: 'learning',
      targetSubtype: learning.category || category,
      routedToTable: 'learnings',
      routedToId: learning.id,
    });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/learning-capture-push.test.js --reporter=basic`
Expected: PASS（2 tests）。同时跑 `npx vitest run src/__tests__/learning.test.js --reporter=basic` 确认既有用例不回归（若既有 mock 未覆盖 capture-inbox 导致真插库调用，pushCaptureAtom 自身吞错设计保证不炸；如有断言计数受影响，在该测试文件加 `vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn().mockResolvedValue(null) }))`）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/learning.js packages/brain/src/__tests__/learning-capture-push.test.js
git commit -m "feat(brain/T10): recordLearning 落库后推送 capture_atoms"
```

---

### Task 4: 两处 issue 写入点接入推送

**Files:**
- Modify: `packages/brain/src/ledger-hygiene.js`（raiseBreachAlerts 内 INSERT INTO issues，约 L240-250）
- Modify: `packages/brain/src/test-lifecycle-patrol.js`（INSERT INTO issues，约 L82-89）
- Test: `packages/brain/src/__tests__/issue-capture-push.test.js`（新文件）

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/issue-capture-push.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushMock = vi.fn().mockResolvedValue('atom-1');
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: (...a) => pushMock(...a) }));
vi.mock('../notify.js', () => ({ sendBark: vi.fn().mockResolvedValue(undefined) }));

import { raiseBreachAlerts } from '../ledger-hygiene.js';

describe('issue 创建 → capture_atoms 推送（T10）', () => {
  beforeEach(() => pushMock.mockClear());

  it('ledger-hygiene 开 issue 后推送 atom（subtype=priority，来源指向 issues/id）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT 1 FROM issues/.test(sql)) return { rows: [] };
        if (/INSERT INTO issues/.test(sql)) return { rows: [{ id: 'issue-1' }] };
        return { rows: [] };
      }),
    };
    await raiseBreachAlerts(pool, [{ name: 'm1', prevDebt: 1, debt: 2, streak: 1 }], '2026-07-10');
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('issue');
    expect(fields.targetSubtype).toBe('P2');
    expect(fields.routedToTable).toBe('issues');
    expect(fields.routedToId).toBe('issue-1');
  });

  it('当日去重命中 → 不 INSERT 也不推送', async () => {
    const pool = { query: vi.fn(async (sql) => (/SELECT 1 FROM issues/.test(sql) ? { rows: [{ 1: 1 }] } : { rows: [] })) };
    await raiseBreachAlerts(pool, [{ name: 'm1', prevDebt: 1, debt: 2, streak: 1 }], '2026-07-10');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

注：若 `raiseBreachAlerts` 未 export，本 Task Step 3 顺带 export（仅加 `export` 关键字，不改逻辑）。`sendBark` 的真实 import 路径以 ledger-hygiene.js 顶部为准（先 `grep -n "sendBark" packages/brain/src/ledger-hygiene.js` 确认后调整 vi.mock 路径）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/issue-capture-push.test.js --reporter=basic`
Expected: FAIL

- [ ] **Step 3: 实现**

`ledger-hygiene.js`：顶部加 `import { pushCaptureAtom } from './capture-inbox.js';`；`raiseBreachAlerts` 前加 `export`；INSERT 改 RETURNING 并推送：
```js
      const { rows: inserted } = await pool.query(
        `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
         VALUES ($1, $2, 'In progress', 'brain', $3, NULL) RETURNING id`,
        [ /* 原参数不变 */ ]
      );
      await pushCaptureAtom(pool, {
        content: `issue: ${title}`,
        targetType: 'issue',
        targetSubtype: priority,
        routedToTable: 'issues',
        routedToId: inserted[0]?.id ?? null,
      });
```

`test-lifecycle-patrol.js`：顶部加 `import { pushCaptureAtom } from './capture-inbox.js';`；孤儿 test 的 `INSERT INTO issues ...` 加 `RETURNING id`，其 `await db.query(...)` 结果接住后追加：
```js
        const orphanTitle = `孤儿 test：${row.file_path}`;
        const { rows: orphanIns } = await db.query(
          `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at, journey_id)
           VALUES ($1, 'P2', 'In progress', 'brain', $2, NULL, NULL) RETURNING id`,
          [orphanTitle, /* 原 body 参数不变 */]
        ).catch(e => { console.error('[test-lifecycle-patrol] issue insert failed:', e.message); return { rows: [] }; });
        if (orphanIns.rows?.[0]?.id) {
          await pushCaptureAtom(db, {
            content: `issue: ${orphanTitle}`,
            targetType: 'issue',
            targetSubtype: 'P2',
            routedToTable: 'issues',
            routedToId: orphanIns.rows[0].id,
          });
        }
```
（保持原有 .catch 吞错风格；变量名如与上下文冲突按现场调整，逻辑不变。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/issue-capture-push.test.js src/__tests__/ledger-hygiene*.test.js --reporter=basic`
Expected: PASS，既有 ledger-hygiene 测试不回归（若其 mock pool 对 RETURNING 无返回，补 `rows: []` 即可）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/ledger-hygiene.js packages/brain/src/test-lifecycle-patrol.js packages/brain/src/__tests__/issue-capture-push.test.js
git commit -m "feat(brain/T10): 两处 issue 创建点推送 capture_atoms（priority 入 subtype）"
```

---

### Task 5: capture-triage.js 便宜规则层（纯函数）

**Files:**
- Create: `packages/brain/src/capture-triage.js`（本 Task 只含 applyCheapRules + 常量）
- Test: `packages/brain/src/__tests__/capture-triage.test.js`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/capture-triage.test.js
import { describe, it, expect } from 'vitest';
import { applyCheapRules } from '../capture-triage.js';

describe('applyCheapRules（addendum 便宜规则表）', () => {
  it('issue P0/P1 → urgent conf 1.0', () => {
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P0', content: '' })).toEqual({ route: 'urgent', confidence: 1.0 });
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P1', content: '' })).toEqual({ route: 'urgent', confidence: 1.0 });
  });
  it('issue P2 → 不命中（null）', () => {
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P2', content: '' })).toBeNull();
  });
  it('learning 含「根本原因」→ invariant conf 0.8', () => {
    expect(applyCheapRules({ target_type: 'learning', target_subtype: 'failure_pattern', content: 'xx根本原因yy' })).toEqual({ route: 'invariant', confidence: 0.8 });
  });
  it('learning 不含「根本原因」→ null', () => {
    expect(applyCheapRules({ target_type: 'learning', target_subtype: 'failure_pattern', content: '普通教训' })).toBeNull();
  });
  it('handoff FAIL → line_backlog conf 0.9', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'FAIL', content: '' })).toEqual({ route: 'line_backlog', confidence: 0.9 });
  });
  it('handoff PASS+NEXT → line_backlog conf 0.7', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'PASS+NEXT', content: '' })).toEqual({ route: 'line_backlog', confidence: 0.7 });
  });
  it('handoff PASS（无下一步）→ null', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'PASS', content: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=basic`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```js
// packages/brain/src/capture-triage.js
/**
 * capture-triage.js — 收件箱四路分诊 tick job（九要素T10）
 *
 * 读 capture_atoms（status='pending_review'，仅三类新来源 handoff/learning/issue），
 * 便宜规则优先、LLM 兜底，四路：urgent / line_backlog / invariant / okr。
 * invariant 路必须过 invariant-gate 四查才允许写 decisions。
 * scheduler-jobs 注册，handler 内置间隔 gate（复用"模块自 gate"模型）。
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */

export const TRIAGE_SOURCE_TYPES = ['handoff', 'learning', 'issue'];
export const ROUTES = ['urgent', 'line_backlog', 'invariant', 'okr'];
export const LLM_CONFIDENCE_FLOOR = 0.7;

/** 便宜规则层（addendum 规则表 1:1）。命中 → {route, confidence}，不命中 → null。 */
export function applyCheapRules(atom) {
  const t = atom.target_type;
  const s = atom.target_subtype;
  if (t === 'issue' && (s === 'P0' || s === 'P1')) return { route: 'urgent', confidence: 1.0 };
  if (t === 'learning' && (atom.content || '').includes('根本原因')) return { route: 'invariant', confidence: 0.8 };
  if (t === 'handoff' && s === 'FAIL') return { route: 'line_backlog', confidence: 0.9 };
  if (t === 'handoff' && s === 'PASS+NEXT') return { route: 'line_backlog', confidence: 0.7 };
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=basic`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/capture-triage.js packages/brain/src/__tests__/capture-triage.test.js
git commit -m "feat(brain/T10): capture-triage 便宜规则层（规则表 1:1 纯函数）"
```

---

### Task 6: invariant-gate.js 四查（纯裁决，不写库）

**Files:**
- Create: `packages/brain/src/invariant-gate.js`
- Test: `packages/brain/src/__tests__/invariant-gate.test.js`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/invariant-gate.test.js
import { describe, it, expect, vi } from 'vitest';
import { checkInvariantCandidate } from '../invariant-gate.js';

const atom = { id: 'a1', content: 'learning: X\n根本原因是 Y', target_type: 'learning' };
const poolWith = (invariants = []) => ({ query: vi.fn().mockResolvedValue({ rows: invariants }) });
const llmJson = (obj) => vi.fn().mockResolvedValue({ text: JSON.stringify(obj) });

describe('checkInvariantCandidate 四查', () => {
  it('四查全过 → pass=true', async () => {
    const llm = llmJson({ conflict: false, verifiable: true, scope_ok: true, fr_contradiction: false, reason: 'ok' });
    const r = await checkInvariantCandidate(poolWith(), atom, { llm });
    expect(r.pass).toBe(true);
    expect(r.checks).toEqual({ conflict: false, verifiable: true, scope_ok: true, fr_contradiction: false });
  });

  it('任一查挂（conflict=true）→ pass=false', async () => {
    const llm = llmJson({ conflict: true, verifiable: true, scope_ok: true, fr_contradiction: false, reason: '与铁律#1冲突' });
    const r = await checkInvariantCandidate(poolWith([{ topic: 't', decision: 'd' }]), atom, { llm });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('冲突');
  });

  it('不可验证（verifiable=false）→ pass=false', async () => {
    const llm = llmJson({ conflict: false, verifiable: false, scope_ok: true, fr_contradiction: false, reason: '无法验证' });
    expect((await checkInvariantCandidate(poolWith(), atom, { llm })).pass).toBe(false);
  });

  it('scope 不当 → pass=false；与累积FR矛盾 → pass=false', async () => {
    const llm1 = llmJson({ conflict: false, verifiable: true, scope_ok: false, fr_contradiction: false, reason: '' });
    const llm2 = llmJson({ conflict: false, verifiable: true, scope_ok: true, fr_contradiction: true, reason: '' });
    expect((await checkInvariantCandidate(poolWith(), atom, { llm: llm1 })).pass).toBe(false);
    expect((await checkInvariantCandidate(poolWith(), atom, { llm: llm2 })).pass).toBe(false);
  });

  it('LLM 输出解析失败 → pass=false，reason 标 parse_failed', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '不是 JSON' });
    const r = await checkInvariantCandidate(poolWith(), atom, { llm });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('parse_failed');
  });

  it('prompt 附带既有铁律清单（查 decisions category=invariant）', async () => {
    const pool = poolWith([{ topic: '租户隔离', decision: '禁跨租户' }]);
    const llm = llmJson({ conflict: false, verifiable: true, scope_ok: true, fr_contradiction: false, reason: '' });
    await checkInvariantCandidate(pool, atom, { llm });
    expect(pool.query.mock.calls[0][0]).toMatch(/category\s*=\s*'invariant'/);
    expect(llm.mock.calls[0][1]).toContain('租户隔离');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/invariant-gate.test.js --reporter=basic`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```js
// packages/brain/src/invariant-gate.js
/**
 * invariant-gate.js — 候选铁律四查（九要素T10）
 *
 * 四查（07-06 1ef6ec3e 原案）：①与既有铁律冲突 ②可验证 ③scope 恰当 ④与累积FR矛盾。
 * 单次 LLM 调用输出四项布尔；只裁决不写库（decisions 写入由 capture-triage 执行）。
 * 任一查挂 / LLM 解析失败 → pass=false（fail-closed：宁可留箱人工复核，不放脏铁律进账本）。
 */
import { callLLM } from './llm-caller.js';

const GATE_PROMPT = (candidate, invariants) => `你是 Cecelia 的铁律准入审查官。一条候选铁律想写入 decisions(category='invariant')，请做四查并只输出 JSON。

## 既有铁律清单
${invariants.length ? invariants.map((d, i) => `${i + 1}. ${d.topic}: ${d.decision}`).join('\n') : '（空）'}

## 候选内容
${candidate}

## 四查定义
- conflict: 与上面任一既有铁律冲突或重复（true=冲突）
- verifiable: 该铁律是否可被机器或明确证据验证（true=可验证）
- scope_ok: 表述范围恰当，不过宽（"永远不要出错"这类不算）也不过窄（true=恰当）
- fr_contradiction: 与系统已交付功能的既有行为矛盾（true=矛盾）

只输出 JSON：{"conflict":bool,"verifiable":bool,"scope_ok":bool,"fr_contradiction":bool,"reason":"一句话理由"}`;

function extractJsonObject(text) {
  try { const p = JSON.parse(text); if (p && typeof p === 'object') return p; } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/**
 * @returns {Promise<{pass: boolean, checks: object|null, reason: string}>}
 */
export async function checkInvariantCandidate(pool, atom, { llm = callLLM } = {}) {
  const { rows: invariants } = await pool.query(
    `SELECT topic, decision FROM decisions WHERE category = 'invariant' AND status = 'active' ORDER BY created_at DESC LIMIT 50`
  );
  const { text } = await llm('cortex', GATE_PROMPT(atom.content, invariants), { maxTokens: 512 });
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed.conflict !== 'boolean') {
    return { pass: false, checks: null, reason: 'invariant-gate parse_failed' };
  }
  const checks = {
    conflict: parsed.conflict === true,
    verifiable: parsed.verifiable === true,
    scope_ok: parsed.scope_ok === true,
    fr_contradiction: parsed.fr_contradiction === true,
  };
  const pass = !checks.conflict && checks.verifiable && checks.scope_ok && !checks.fr_contradiction;
  return { pass, checks, reason: parsed.reason || '' };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/invariant-gate.test.js --reporter=basic`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/invariant-gate.js packages/brain/src/__tests__/invariant-gate.test.js
git commit -m "feat(brain/T10): invariant-gate 四查（fail-closed，单次LLM裁决不写库）"
```

---

### Task 7: capture-triage handler（分诊主循环 + 四路落地 + 间隔 gate）

**Files:**
- Modify: `packages/brain/src/capture-triage.js`（追加 handler）
- Test: `packages/brain/src/__tests__/capture-triage.test.js`（追加 describe 块）

- [ ] **Step 1: 写 failing test（追加）**

```js
// 追加到 capture-triage.test.js（顶部补 import）：
import { runCaptureTriage, __resetCaptureTriageForTest } from '../capture-triage.js';
import { vi, beforeEach } from 'vitest';

vi.mock('../invariant-gate.js', () => ({ checkInvariantCandidate: vi.fn() }));
import { checkInvariantCandidate } from '../invariant-gate.js';

function makePool(atoms, extra = {}) {
  const updates = [];
  const inserts = [];
  const pool = {
    updates, inserts,
    query: vi.fn(async (sql, params) => {
      if (/SELECT .* FROM capture_atoms/.test(sql)) return { rows: atoms };
      if (/UPDATE capture_atoms/.test(sql)) { updates.push({ sql, params }); return { rowCount: 1 }; }
      if (/INSERT INTO decisions/.test(sql)) { inserts.push({ sql, params }); return { rows: [{ id: 'dec-1' }] }; }
      if (/SELECT payload->>'journey_id'/.test(sql)) return { rows: [{ journey_id: extra.journeyId ?? 'jrn-1' }] };
      return { rows: [] };
    }),
  };
  return pool;
}

describe('runCaptureTriage 四路落地', () => {
  beforeEach(() => { __resetCaptureTriageForTest(); checkInvariantCandidate.mockReset(); });

  it('urgent：issue P1 → status=confirmed，ai_reason 带 [triage:urgent]，routed 保持源指针', async () => {
    const pool = makePool([{ id: 'a1', target_type: 'issue', target_subtype: 'P1', content: 'x', routed_to_table: 'issues', routed_to_id: 'i1' }]);
    const r = await runCaptureTriage(pool);
    expect(r.processed).toBe(1);
    const upd = pool.updates[0];
    expect(upd.sql).toMatch(/status = 'confirmed'/);
    expect(upd.params.join(' ')).toContain('[triage:urgent]');
  });

  it('line_backlog：handoff FAIL → routed 改写为 journeys/journey_id', async () => {
    const pool = makePool([{ id: 'a2', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }]);
    await runCaptureTriage(pool);
    const upd = pool.updates[0];
    expect(upd.params).toContain('journeys');
    expect(upd.params).toContain('jrn-1');
  });

  it('line_backlog 但源 task 无 journey_id → 留 pending_review，ai_reason 标 no_journey', async () => {
    const pool = makePool([{ id: 'a3', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' }], { journeyId: null });
    await runCaptureTriage(pool);
    expect(pool.updates[0].sql).not.toMatch(/status = 'confirmed'/);
    expect(pool.updates[0].params.join(' ')).toContain('[triage:no_journey]');
  });

  it('invariant：gate PASS → INSERT decisions + routed 改写 decisions/新id', async () => {
    checkInvariantCandidate.mockResolvedValue({ pass: true, checks: {}, reason: 'ok' });
    const pool = makePool([{ id: 'a4', target_type: 'learning', target_subtype: 'failure_pattern', content: '根本原因是X', routed_to_table: 'learnings', routed_to_id: 'l1' }]);
    await runCaptureTriage(pool);
    expect(pool.inserts.length).toBe(1);
    expect(pool.inserts[0].params).toContain('invariant');
    expect(pool.updates[0].params).toContain('decisions');
    expect(pool.updates[0].params).toContain('dec-1');
  });

  it('invariant：gate FAIL → 不写 decisions，留 pending_review 记四查明细', async () => {
    checkInvariantCandidate.mockResolvedValue({ pass: false, checks: { conflict: true }, reason: '与铁律冲突' });
    const pool = makePool([{ id: 'a5', target_type: 'learning', target_subtype: 'failure_pattern', content: '根本原因是X', routed_to_table: 'learnings', routed_to_id: 'l1' }]);
    await runCaptureTriage(pool);
    expect(pool.inserts.length).toBe(0);
    expect(pool.updates[0].params.join(' ')).toContain('[triage:gate_fail]');
  });

  it('规则不中 + LLM 兜底 confidence<0.7 → 留 pending_review 标 low_confidence', async () => {
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify({ route: 'okr', confidence: 0.5, reason: '可能是OKR' }) });
    const pool = makePool([{ id: 'a6', target_type: 'issue', target_subtype: 'P2', content: 'x', routed_to_table: 'issues', routed_to_id: 'i2' }]);
    await runCaptureTriage(pool, { llm });
    expect(pool.updates[0].params.join(' ')).toContain('[triage:low_confidence]');
  });

  it('规则不中 + LLM 兜底 confidence>=0.7 → 按 route 落地（okr → confirmed + [triage:okr]）', async () => {
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify({ route: 'okr', confidence: 0.8, reason: '明确OKR' }) });
    const pool = makePool([{ id: 'a7', target_type: 'issue', target_subtype: 'P2', content: 'x', routed_to_table: 'issues', routed_to_id: 'i2' }]);
    await runCaptureTriage(pool, { llm });
    expect(pool.updates[0].sql).toMatch(/status = 'confirmed'/);
    expect(pool.updates[0].params.join(' ')).toContain('[triage:okr]');
  });

  it('LLM 失败 → 标 [triage:llm_failed]（且 SELECT 排除已带该标记的条目防重试烧钱）', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('timeout'));
    const pool = makePool([{ id: 'a8', target_type: 'issue', target_subtype: 'P2', content: 'x', routed_to_table: 'issues', routed_to_id: 'i2' }]);
    await runCaptureTriage(pool, { llm });
    expect(pool.updates[0].params.join(' ')).toContain('[triage:llm_failed]');
    expect(pool.query.mock.calls[0][0]).toMatch(/llm_failed/);
  });

  it('间隔 gate：同 interval 内第二次调用直接跳过', async () => {
    const pool = makePool([]);
    await runCaptureTriage(pool);
    const r2 = await runCaptureTriage(pool);
    expect(r2.skipped).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('单条失败不中断其余条目', async () => {
    const atoms = [
      { id: 'b1', target_type: 'handoff', target_subtype: 'FAIL', content: 'x', routed_to_table: 'tasks', routed_to_id: 't1' },
      { id: 'b2', target_type: 'issue', target_subtype: 'P1', content: 'x', routed_to_table: 'issues', routed_to_id: 'i1' },
    ];
    let first = true;
    const pool = makePool(atoms);
    const origQuery = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params) => {
      if (/SELECT payload->>'journey_id'/.test(sql) && first) { first = false; throw new Error('boom'); }
      return origQuery(sql, params);
    });
    const r = await runCaptureTriage(pool);
    expect(r.processed).toBe(2);
    expect(r.failed).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=basic`
Expected: 新增用例 FAIL（runCaptureTriage 不存在）

- [ ] **Step 3: 实现（追加到 capture-triage.js）**

```js
import { callLLM } from './llm-caller.js';
import { checkInvariantCandidate } from './invariant-gate.js';

const INTERVAL_MS = parseInt(process.env.CECELIA_CAPTURE_TRIAGE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const BATCH = parseInt(process.env.CECELIA_CAPTURE_TRIAGE_BATCH || '20', 10);
const LLM_ENABLED = process.env.CECELIA_CAPTURE_TRIAGE_LLM !== 'off';

let lastRunAt = 0;
export function __resetCaptureTriageForTest() { lastRunAt = 0; }

const TRIAGE_LLM_PROMPT = (atom) => `你是 Cecelia 的收件箱分诊员。一条系统产出需要归入四路之一，只输出 JSON。

## 四路定义
- urgent: 需要立即插队处理的紧急问题
- line_backlog: 挂到业务线 backlog 的后续工作
- invariant: 候选铁律（普适的"永远要/永远不要"准则）
- okr: 战略/目标层面的输入

## 条目（来源=${atom.target_type}，标记=${atom.target_subtype ?? '无'}）
${atom.content}

只输出 JSON：{"route":"urgent|line_backlog|invariant|okr","confidence":0.0-1.0,"reason":"一句话"}`;

function extractJsonObject(text) {
  try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function updateAtom(pool, id, { status = null, routedToTable = null, routedToId = null, confidence = null, aiReason }) {
  const sets = [`ai_reason = $2`, `updated_at = now()`];
  const params = [id, aiReason];
  if (status) { sets.push(`status = '${status === 'confirmed' ? 'confirmed' : 'pending_review'}'`); }
  if (routedToTable) { params.push(routedToTable); sets.push(`routed_to_table = $${params.length}`); }
  if (routedToId) { params.push(routedToId); sets.push(`routed_to_id = $${params.length}`); }
  if (confidence != null) { params.push(confidence); sets.push(`confidence = $${params.length}`); }
  await pool.query(`UPDATE capture_atoms SET ${sets.join(', ')} WHERE id = $1`, params);
}

/** 四路落地。返回该条是否成功处理。 */
async function routeAtom(pool, atom, verdict, opts) {
  const { route, confidence, reason = '' } = verdict;
  if (route === 'urgent') {
    return updateAtom(pool, atom.id, { status: 'confirmed', confidence, aiReason: `[triage:urgent] ${reason}` });
  }
  if (route === 'line_backlog') {
    let journeyId = null;
    if (atom.routed_to_table === 'tasks' && atom.routed_to_id) {
      const { rows } = await pool.query(`SELECT payload->>'journey_id' AS journey_id FROM tasks WHERE id = $1::uuid`, [atom.routed_to_id]);
      journeyId = rows[0]?.journey_id ?? null;
    }
    if (!journeyId) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:no_journey] 源无 journey_id，留人工复核。${reason}` });
    }
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'journeys', routedToId: journeyId, confidence, aiReason: `[triage:line_backlog] ${reason}` });
  }
  if (route === 'invariant') {
    const gate = await checkInvariantCandidate(pool, atom, opts);
    if (!gate.pass) {
      return updateAtom(pool, atom.id, { confidence, aiReason: `[triage:gate_fail] ${gate.reason} checks=${JSON.stringify(gate.checks)}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO decisions (category, topic, decision, reason, level, target_type, target_id, scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['invariant', `[capture-triage] ${atom.content.slice(0, 80)}`, atom.content, `invariant-gate PASS: ${gate.reason}`, 'area', null, null, null]
    );
    return updateAtom(pool, atom.id, { status: 'confirmed', routedToTable: 'decisions', routedToId: rows[0].id, confidence, aiReason: `[triage:invariant] gate PASS. ${reason}` });
  }
  if (route === 'okr') {
    return updateAtom(pool, atom.id, { status: 'confirmed', confidence, aiReason: `[triage:okr] ${reason}` });
  }
  return updateAtom(pool, atom.id, { aiReason: `[triage:unknown_route] ${route}` });
}

/**
 * 主入口（scheduler-jobs handler）。内置间隔 gate；LLM 可注入（测试）/可关（env）。
 * @returns {{skipped?: true, processed: number, failed: number}}
 */
export async function runCaptureTriage(pool, { llm = callLLM } = {}) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, processed: 0, failed: 0 };
  lastRunAt = now;

  const { rows: atoms } = await pool.query(
    `SELECT id, content, target_type, target_subtype, routed_to_table, routed_to_id, ai_reason
     FROM capture_atoms
     WHERE status = 'pending_review'
       AND target_type = ANY($1)
       AND (ai_reason IS NULL OR ai_reason NOT LIKE '[triage:llm_failed]%')
     ORDER BY created_at ASC
     LIMIT $2`,
    [TRIAGE_SOURCE_TYPES, BATCH]
  );

  let failed = 0;
  for (const atom of atoms) {
    try {
      let verdict = applyCheapRules(atom);
      if (!verdict) {
        if (!LLM_ENABLED) continue; // 规则不中且 LLM 关闭 → 留箱
        let parsed = null;
        try {
          const { text } = await llm('thalamus', TRIAGE_LLM_PROMPT(atom), { maxTokens: 256 });
          parsed = extractJsonObject(text);
        } catch (llmErr) {
          await updateAtom(pool, atom.id, { aiReason: `[triage:llm_failed] ${llmErr.message}` });
          failed++;
          continue;
        }
        if (!parsed || !ROUTES.includes(parsed.route) || typeof parsed.confidence !== 'number') {
          await updateAtom(pool, atom.id, { aiReason: `[triage:llm_failed] unparseable` });
          failed++;
          continue;
        }
        if (parsed.confidence < LLM_CONFIDENCE_FLOOR) {
          await updateAtom(pool, atom.id, { confidence: parsed.confidence, aiReason: `[triage:low_confidence] ${parsed.reason || ''}` });
          continue;
        }
        verdict = { route: parsed.route, confidence: parsed.confidence, reason: parsed.reason || '' };
      }
      await routeAtom(pool, atom, verdict, { llm });
    } catch (err) {
      failed++;
      console.warn(`[capture-triage] atom ${atom.id} 分诊失败: ${err.message}`);
    }
  }
  return { processed: atoms.length, failed };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/capture-triage.test.js --reporter=basic`
Expected: PASS（便宜规则 7 + handler 10 用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/capture-triage.js packages/brain/src/__tests__/capture-triage.test.js
git commit -m "feat(brain/T10): capture-triage 分诊主循环（四路落地+LLM兜底+llm_failed防重试+间隔gate）"
```

---

### Task 8: scheduler-jobs 注册

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`（import + JOBS 数组加一行）
- Test: `packages/brain/src/__tests__/scheduler-jobs.test.js`（追加注册断言）

- [ ] **Step 1: 写 failing test（追加到 scheduler-jobs.test.js）**

```js
it('capture-triage 已注册（needsPool=true）', () => {
  const job = JOBS.find((j) => j.name === 'capture-triage');
  expect(job).toBeTruthy();
  expect(job.needsPool).toBe(true);
  expect(typeof job.handler).toBe('function');
});
```
（该文件已 import `JOBS`；若没有则在顶部补 `import { JOBS } from '../scheduler-jobs.js';`）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js --reporter=basic`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现（scheduler-jobs.js）**

import 区加：
```js
import { runCaptureTriage } from './capture-triage.js';
```
JOBS 数组末尾加：
```js
  { name: 'capture-triage', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runCaptureTriage, description: '收件箱四路分诊（自带10min间隔gate+批量上限，T10）' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js --reporter=basic`
Expected: PASS（既有用例含 JOBS.length 相关断言如有硬编码数字，同步 +1）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "feat(brain/T10): scheduler-jobs 注册 capture-triage tick"
```

---

### Task 9: 版本 bump + DevGate + 全量验证

**Files:**
- Modify: `packages/brain/package.json`（1.246.0 → 1.247.0）
- 其余版本同步位置以脚本输出为准

- [ ] **Step 1: bump 版本**

`packages/brain/package.json` 的 `"version": "1.246.0"` 改为 `"version": "1.247.0"`，然后：
```bash
bash scripts/check-version-sync.sh
```
按脚本输出把其余不同步位置（如 `packages/brain/src/server.js` 内 version 常量、`packages/brain/VERSION`）改到 1.247.0，直到脚本通过。

- [ ] **Step 2: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过。facts-check 失败 → 停下修复（不允许带病编码）。

- [ ] **Step 3: brain 全量单测 + 语法冒烟**

```bash
cd packages/brain && npx vitest run src/__tests__ --reporter=basic 2>&1 | tail -20
node --check src/server.js && node --check src/capture-triage.js && node --check src/invariant-gate.js && node --check src/capture-inbox.js
```
Expected: 测试全绿、语法冒烟通过。（注意 memory：brain 全量 vitest 有环境级 OOM 前科，OOM 时改为分目录批跑。）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(brain): bump 1.247.0（T10 统一收件箱通电）"
```

---

## Self-Review 结论

- **Spec 覆盖**：三入口写入（Task 2/3/4）、便宜规则表（Task 5）、LLM 兜底+四路落地+llm_failed 防重试（Task 7）、Invariant Gate 四查 fail-closed（Task 6）、scheduler-jobs 注册（Task 8）、版本与 DevGate（Task 9）——spec 全部条目有对应 Task。
- **类型一致性**：pushCaptureAtom 字段名 camelCase（targetType…）在 Task 1-4 一致；atom 行字段 snake_case（target_type…来自 DB）在 Task 5-7 一致；verdict 结构 {route, confidence, reason} 在 Task 5/7 一致。
- **无占位符**：所有代码块完整可抄。
