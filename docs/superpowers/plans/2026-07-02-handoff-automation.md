# Handoff 自动化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** harness 任务终态自动产一份结构化交接单（tasks.result.handoff + docs/handoffs/ 镜像），下一次 planner 自动加载注入 prompt。

**Architecture:** 新模块 `packages/brain/src/handoff.js`（build/save/query/format 四个纯粹函数）+ `harness-initiative.graph.js` 两处 best-effort 挂点（reportNode 终态生成、runPlannerNode 注入），完全复制 A3 promote-regression 的 dynamic-import + try/catch-warn 模式，失败绝不阻断主流程。DB（tasks.result.handoff JSONB）是 SSOT，markdown 镜像 best-effort 不进 git。

**Tech Stack:** Node ESM + pg pool（mock 单测）+ vitest + real-env smoke（psql 临时行 + 清理 trap）。

Spec: `docs/superpowers/specs/2026-07-02-handoff-automation-design.md`

---

### Task 1: handoff.js — buildHandoff + renderHandoffMarkdown（TDD）

**Files:**
- Create: `packages/brain/src/handoff.js`
- Test: `packages/brain/src/__tests__/handoff.test.js`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/handoff.test.js
/**
 * handoff.test.js — 方案B handoff 模块单测。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHandoff, renderHandoffMarkdown, saveHandoff,
  getRecentHandoffs, formatHandoffsForPrompt,
  HANDOFF_SCHEMA_VERSION, BASELINE_DATA_SOURCES,
} from '../handoff.js';

const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('buildHandoff', () => {
  it('缺 task_id 抛错', () => {
    expect(() => buildHandoff({})).toThrow(/task_id/);
  });

  it('最小输入产完整 schema：默认值 + 基线 data_sources', () => {
    const h = buildHandoff({ task_id: TASK_ID });
    expect(h.schema_version).toBe(HANDOFF_SCHEMA_VERSION);
    expect(h.task_id).toBe(TASK_ID);
    expect(h.initiative_id).toBeNull();
    expect(h.journey_id).toBeNull();
    expect(h.verdict).toBeNull();
    expect(h.done).toEqual([]);
    expect(h.data_sources).toEqual(BASELINE_DATA_SOURCES);
    expect(h.artifacts).toEqual({ pr_urls: [], sprint_dir: null, branch: null, docs: [] });
    expect(new Date(h.created_at).toString()).not.toBe('Invalid Date');
  });

  it('截断：每组 >20 条截到 20，单条 >200 字截断加省略号', () => {
    const long = 'x'.repeat(300);
    const h = buildHandoff({ task_id: TASK_ID, done: Array.from({ length: 30 }, () => long) });
    expect(h.done).toHaveLength(20);
    expect(h.done[0].length).toBeLessThanOrEqual(201);
    expect(h.done[0].endsWith('…')).toBe(true);
  });

  it('过滤非字符串与空白项', () => {
    const h = buildHandoff({ task_id: TASK_ID, done: ['ok', '', '  ', null, 42] });
    expect(h.done).toEqual(['ok']);
  });
});

describe('renderHandoffMarkdown', () => {
  it('含全部关键段与字段', () => {
    const h = buildHandoff({
      task_id: TASK_ID, title: '测试任务', verdict: 'PASS',
      done: ['ws1 已合并'], not_done: ['ws2 未完成'], next_steps: ['加厚'],
      artifacts: { pr_urls: ['https://github.com/x/y/pull/1'], sprint_dir: 'sprints/x', branch: null, docs: [] },
    });
    const md = renderHandoffMarkdown(h);
    for (const t of ['# Handoff', '测试任务', 'PASS', '完成了什么', 'ws1 已合并', '没完成什么', 'ws2 未完成', '下一步', '加厚', '数据源', 'pull/1', 'sprints/x']) {
      expect(md).toContain(t);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/handoff.test.js`
Expected: FAIL（Cannot find module '../handoff.js'）

- [ ] **Step 3: commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/__tests__/handoff.test.js
git commit -m "test(brain): handoff 模块 build/render 失败测试（方案B B-1）"
```

- [ ] **Step 4: 实现 buildHandoff + renderHandoffMarkdown**

```js
// packages/brain/src/handoff.js
/**
 * handoff.js — 任务终态交接单（诊断方案 B，2026-07-02）
 *
 * 任务终态自动产一份"给下一个大脑读"的结构化交接单：
 *   - DB SSOT：tasks.result.handoff（JSONB 覆盖写，天然幂等）
 *   - 人读镜像：<HANDOFF_DOCS_DIR>/<yyyymmddHHMM>-<task8>.md（best-effort，不 git commit）
 * 下一次规划（runPlannerNode）按 journey 拉最近 N 份注入 prompt。
 *
 * 与既有件分工：A3 promote-regression 沉淀"行为"（golden_path/回归契约）、
 * harness-report 是给人看的报告；handoff 沉淀"进度与意图"。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import fs from 'node:fs';
import path from 'node:path';

export const HANDOFF_SCHEMA_VERSION = 1;

const DEFAULT_DOCS_DIR = '/Users/administrator/perfect21/cecelia/docs/handoffs';
const MAX_ITEMS = 20;
const MAX_ITEM_LEN = 200;
const PROMPT_MAX_LEN = 2000;

// data_sources 固定基线：与 harness-planner Step 0.3/0.4 同源（A1）。
// 下一个大脑照单加载即可拿到本 line 的铁律 + 已验收行为 + 本单全文。
export const BASELINE_DATA_SOURCES = [
  'GET /api/brain/invariants?level=area',
  'GET /api/brain/invariants?target_type=journey_feature&target_id=<ability_id>',
  'GET /api/brain/journeys/<journey_id>/golden-paths',
  'GET /api/brain/tasks/<task_id>（result.handoff 本体）',
];

function clampList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .slice(0, MAX_ITEMS)
    .map((s) => (s.length > MAX_ITEM_LEN ? `${s.slice(0, MAX_ITEM_LEN)}…` : s));
}

export function buildHandoff(input = {}) {
  if (!input.task_id) throw new Error('buildHandoff: task_id is required');
  return {
    schema_version: HANDOFF_SCHEMA_VERSION,
    task_id: input.task_id,
    initiative_id: input.initiative_id ?? null,
    journey_id: input.journey_id ?? null,
    title: input.title || '',
    verdict: input.verdict ?? null,
    done: clampList(input.done),
    not_done: clampList(input.not_done),
    next_steps: clampList(input.next_steps),
    data_sources: clampList(input.data_sources?.length ? input.data_sources : BASELINE_DATA_SOURCES),
    decision_refs: clampList(input.decision_refs),
    artifacts: {
      pr_urls: clampList(input.artifacts?.pr_urls),
      sprint_dir: input.artifacts?.sprint_dir ?? null,
      branch: input.artifacts?.branch ?? null,
      docs: clampList(input.artifacts?.docs),
    },
    created_at: new Date().toISOString(),
  };
}

export function renderHandoffMarkdown(h) {
  const list = (arr, empty) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : `- （${empty}）`);
  return [
    `# Handoff：${h.title || h.task_id}`,
    '',
    `- task_id: ${h.task_id}`,
    `- initiative_id: ${h.initiative_id ?? 'N/A'}`,
    `- journey_id: ${h.journey_id ?? 'N/A'}`,
    `- verdict: ${h.verdict ?? 'N/A'}`,
    `- created_at: ${h.created_at}`,
    '',
    '## 完成了什么',
    list(h.done, '无'),
    '',
    '## 没完成什么',
    list(h.not_done, '无'),
    '',
    '## 下一步建议',
    list(h.next_steps, '无'),
    '',
    '## 数据源（下一个大脑要加载的）',
    list(h.data_sources, '无'),
    '',
    '## 关键决策引用',
    list(h.decision_refs, '无'),
    '',
    '## 产物指针',
    list(h.artifacts.pr_urls, '无 PR'),
    `- sprint_dir: ${h.artifacts.sprint_dir ?? 'N/A'}`,
    `- branch: ${h.artifacts.branch ?? 'N/A'}`,
    ...(h.artifacts.docs.length ? h.artifacts.docs.map((d) => `- doc: ${d}`) : []),
    '',
  ].join('\n');
}
```

（本 Task 只写到这里；saveHandoff/getRecentHandoffs/formatHandoffsForPrompt 在 Task 2 补齐同一文件。）

- [ ] **Step 5: 跑测试确认 Task 1 的用例全绿**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/handoff.test.js`
Expected: buildHandoff/renderHandoffMarkdown 相关用例 PASS（import saveHandoff 等会失败 → 若 import 报错，把 Step 1 测试文件里 saveHandoff/getRecentHandoffs/formatHandoffsForPrompt 的 import 与 describe 留到 Task 2 再加；本 Task 的 import 只含 buildHandoff/renderHandoffMarkdown/HANDOFF_SCHEMA_VERSION/BASELINE_DATA_SOURCES）

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/handoff.js packages/brain/src/__tests__/handoff.test.js
git commit -m "feat(brain): handoff 模块 buildHandoff+renderHandoffMarkdown（方案B B-1）"
```

---

### Task 2: handoff.js — saveHandoff + getRecentHandoffs + formatHandoffsForPrompt（TDD）

**Files:**
- Modify: `packages/brain/src/handoff.js`（追加三个导出）
- Modify: `packages/brain/src/__tests__/handoff.test.js`（追加用例）

- [ ] **Step 1: 追加 failing tests**

```js
// 追加到 packages/brain/src/__tests__/handoff.test.js（import 行补上 saveHandoff, getRecentHandoffs, formatHandoffsForPrompt）

describe('saveHandoff', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
    process.env.HANDOFF_DOCS_DIR = tmpDir;
  });
  afterEach(() => {
    delete process.env.HANDOFF_DOCS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('先写 DB（jsonb 合并 UPDATE）再写 markdown 镜像', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const h = buildHandoff({ task_id: TASK_ID, title: 't' });
    const r = await saveHandoff({ pool }, h);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE tasks SET result = COALESCE\(result, '\{\}'::jsonb\) \|\| jsonb_build_object\('handoff', \$2::jsonb\)/);
    expect(params[0]).toBe(TASK_ID);
    expect(JSON.parse(params[1]).task_id).toBe(TASK_ID);
    expect(r.dbWritten).toBe(true);
    expect(r.mirrorPath).toMatch(new RegExp(`${TASK_ID.slice(0, 8)}\\.md$`));
    expect(fs.readFileSync(r.mirrorPath, 'utf8')).toContain('# Handoff');
  });

  it('DB 失败 → 抛错且不写镜像文件（防分裂态）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const h = buildHandoff({ task_id: TASK_ID });
    await expect(saveHandoff({ pool }, h)).rejects.toThrow('db down');
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('镜像写失败 → 不抛错，dbWritten 仍 true，mirrorPath=null', async () => {
    process.env.HANDOFF_DOCS_DIR = path.join(tmpDir, 'no-such', '\0bad');
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const r = await saveHandoff({ pool }, buildHandoff({ task_id: TASK_ID }));
    expect(r.dbWritten).toBe(true);
    expect(r.mirrorPath).toBeNull();
  });
});

describe('getRecentHandoffs', () => {
  it('无 journeyId 直接返回空数组不查库', async () => {
    const pool = { query: vi.fn() };
    expect(await getRecentHandoffs({ pool }, {})).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('按 journey 查、排除自身、带 limit', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 'a' }] })) };
    const rows = await getRecentHandoffs({ pool }, { journeyId: 'j1', limit: 3, excludeTaskId: TASK_ID });
    expect(rows).toEqual([{ id: 'a' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/payload->>'journey_id' = \$1/);
    expect(sql).toMatch(/result \? 'handoff'/);
    expect(sql).toMatch(/ORDER BY completed_at DESC NULLS LAST/);
    expect(params).toEqual(['j1', TASK_ID, 3]);
  });
});

describe('formatHandoffsForPrompt', () => {
  it('空/无数据 → 空字符串', () => {
    expect(formatHandoffsForPrompt([])).toBe('');
    expect(formatHandoffsForPrompt(null)).toBe('');
  });

  it('压缩：每份 ≤ done3/not_done2/next2 条，含段头', () => {
    const rows = [{
      id: 'a', title: 'ta',
      handoff: {
        title: 'ta', verdict: 'PASS',
        done: ['d1', 'd2', 'd3', 'd4'], not_done: ['n1', 'n2', 'n3'], next_steps: ['s1', 's2', 's3'],
      },
    }];
    const t = formatHandoffsForPrompt(rows);
    expect(t).toContain('## 最近 Handoff');
    expect(t).toContain('ta（verdict=PASS）');
    expect(t).toContain('✅ d3');
    expect(t).not.toContain('d4');
    expect(t).not.toContain('n3');
    expect(t).not.toContain('s3');
  });

  it('总长截断 ≤2000 字', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), title: 't', handoff: { title: 'x'.repeat(400), verdict: 'FAIL', done: [], not_done: [], next_steps: [] },
    }));
    expect(formatHandoffsForPrompt(rows).length).toBeLessThanOrEqual(2001);
  });
});
```

- [ ] **Step 2: 跑测试确认新增用例失败**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/handoff.test.js`
Expected: FAIL（saveHandoff 等未导出）

- [ ] **Step 3: commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/__tests__/handoff.test.js
git commit -m "test(brain): handoff save/query/format 失败测试（方案B B-1）"
```

- [ ] **Step 4: 实现三个函数（追加到 handoff.js）**

```js
/**
 * 保存交接单：先 DB（SSOT），成功后 best-effort 写 markdown 镜像。
 * DB 失败直接抛（调用方决定是否吞）；镜像失败仅 warn。
 */
export async function saveHandoff({ pool }, handoff) {
  await pool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('handoff', $2::jsonb), updated_at = NOW()
     WHERE id = $1::uuid`,
    [handoff.task_id, JSON.stringify(handoff)]
  );
  let mirrorPath = null;
  try {
    const dir = process.env.HANDOFF_DOCS_DIR || DEFAULT_DOCS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = handoff.created_at.replace(/[-:T]/g, '').slice(0, 12);
    mirrorPath = path.join(dir, `${stamp}-${String(handoff.task_id).slice(0, 8)}.md`);
    fs.writeFileSync(mirrorPath, renderHandoffMarkdown(handoff));
  } catch (err) {
    console.warn(`[handoff] markdown mirror failed (non-fatal): ${err.message}`);
    mirrorPath = null;
  }
  return { dbWritten: true, mirrorPath };
}

/** 按 journey 拉最近 N 份 handoff（planner 注入用）。journeyId 缺失 → []（不查库）。 */
export async function getRecentHandoffs({ pool }, { journeyId, limit = 3, excludeTaskId = null } = {}) {
  if (!journeyId) return [];
  const params = [journeyId];
  let exclude = '';
  if (excludeTaskId) {
    params.push(excludeTaskId);
    exclude = `AND id != $${params.length}::uuid`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, title, completed_at, result->'handoff' AS handoff
     FROM tasks
     WHERE payload->>'journey_id' = $1 AND result ? 'handoff' ${exclude}
     ORDER BY completed_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/** 压缩为 prompt 注入段：每份 ≤6 行，总长 ≤2000 字；空 → ''。 */
export function formatHandoffsForPrompt(rows) {
  if (!rows?.length) return '';
  const blocks = rows.map((r, i) => {
    const h = r.handoff || {};
    const lines = [`### Handoff ${i + 1}: ${h.title || r.title || r.id}（verdict=${h.verdict ?? 'N/A'}）`];
    for (const d of (h.done || []).slice(0, 3)) lines.push(`- ✅ ${d}`);
    for (const n of (h.not_done || []).slice(0, 2)) lines.push(`- ❌ ${n}`);
    for (const s of (h.next_steps || []).slice(0, 2)) lines.push(`- ➡️ ${s}`);
    return lines.join('\n');
  });
  let text = `\n\n## 最近 Handoff（本 line 交接，规划时不得与已完成项重复、优先响应 next_steps）\n${blocks.join('\n')}`;
  if (text.length > PROMPT_MAX_LEN) text = `${text.slice(0, PROMPT_MAX_LEN)}…`;
  return text;
}
```

- [ ] **Step 5: 跑测试全绿**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/handoff.test.js`
Expected: 全部 PASS

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/handoff.js packages/brain/src/__tests__/handoff.test.js
git commit -m "feat(brain): handoff save/query/format — DB SSOT + 镜像 best-effort（方案B B-1）"
```

---

### Task 3: reportNode 生成点接线（B-2，TDD）

**Files:**
- Create: `packages/brain/src/__tests__/harness-handoff-wiring.test.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（reportNode，A3 promotion 块之后）

- [ ] **Step 1: 写 failing wiring test（mock 前导完整复制 `harness-promote-wiring.test.js` 的 vi.mock 清单，另加 handoff mock）**

```js
// packages/brain/src/__tests__/harness-handoff-wiring.test.js
/**
 * harness-handoff-wiring.test.js — 方案B reportNode/plannerNode 接线测试。
 * PASS 与 FAIL 都产 handoff；handoff 抛错 → reportNode 仍返回 report_path。
 * mock 前导复制 harness-promote-wiring.test.js。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { buildMock, saveMock, getRecentMock, formatMock } = vi.hoisted(() => ({
  buildMock: vi.fn((x) => ({ ...x, schema_version: 1, created_at: '2026-07-02T00:00:00Z' })),
  saveMock: vi.fn(async () => ({ dbWritten: true, mirrorPath: null })),
  getRecentMock: vi.fn(async () => []),
  formatMock: vi.fn(() => ''),
}));

vi.mock('../handoff.js', () => ({
  buildHandoff: buildMock,
  saveHandoff: saveMock,
  getRecentHandoffs: getRecentMock,
  formatHandoffsForPrompt: formatMock,
}));

// ↓↓↓ 以下 vi.mock 清单逐行复制 harness-promote-wiring.test.js（promoteMock/db/spawn/
//     account-rotation/harness-shared/harness-dag/harness-worktree/harness-credentials/
//     git-fence/harness-gan-graph/harness-container-cleanup/okr-initiative-sync/
//     staging-promote/@langchain/langgraph），不再赘述——实施时原样拷贝。

import { reportNode } from '../workflows/harness-initiative.graph.js';

function makePool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  };
}

const INIT_ID = 'dcdbf10f-0000-0000-0000-000000000001';
function makeState(subStatus) {
  return {
    initiativeId: INIT_ID,
    task: { id: INIT_ID, title: 'handoff-demo', payload: { journey_id: 'j1', feature_id: 'f1' } },
    sprintDir: 'sprints/0702-demo',
    worktreePath: '/tmp/wt',
    sub_tasks: [{ id: 'ws1', status: subStatus, pr_url: 'https://github.com/x/y/pull/9', evaluate_verdict: 'PASS' }],
  };
}

describe('reportNode handoff 接线', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('PASS：saveHandoff 被调，verdict=PASS，done 含 ws1', async () => {
    const r = await reportNode(makeState('merged'), { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const built = buildMock.mock.calls[0][0];
    expect(built.verdict).toBe('PASS');
    expect(built.task_id).toBe(INIT_ID);
    expect(built.journey_id).toBe('j1');
    expect(built.done.join()).toContain('ws1');
  });

  it('FAIL：也产 handoff，not_done 含 ws1', async () => {
    const state = makeState('failed');
    state.sub_tasks[0].evaluate_verdict = 'FAIL';
    const r = await reportNode(state, { pool: makePool(), _checkPrMerged: async () => false });
    expect(r.report_path).toBeTruthy();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const built = buildMock.mock.calls[0][0];
    expect(built.verdict).toBe('FAIL');
    expect(built.not_done.join()).toContain('ws1');
  });

  it('handoff 抛错 → reportNode 不受影响返回 report_path', async () => {
    saveMock.mockRejectedValueOnce(new Error('boom'));
    const r = await reportNode(makeState('merged'), { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/harness-handoff-wiring.test.js`
Expected: FAIL（saveHandoff 未被调用，toHaveBeenCalledTimes(1) 断言失败）

- [ ] **Step 3: commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/__tests__/harness-handoff-wiring.test.js
git commit -m "test(brain): reportNode handoff 接线失败测试（方案B B-2）"
```

- [ ] **Step 4: reportNode 注入（`harness-initiative.graph.js`，插在 A3 promotion `if (computedVerdict === 'PASS') {...}` 块的**闭合大括号之后**、`// Slice3（决策 B）` 注释之前）**

```js
  // 方案B（handoff 自动化，2026-07-02）：终态交接单——PASS/FAIL 都产（失败的交接价值更大）。
  // best-effort：失败绝不阻断生命周期闭合。DB=SSOT，镜像 best-effort（handoff.js 内部处理）。
  try {
    const { buildHandoff, saveHandoff } = await import('../handoff.js');
    const failDetail = ws_issues
      .map((w) => `${w.ws_id}${w.ci_fail_type ? `[${w.ci_fail_type}]` : ''}: ${String(w.feedback || '').slice(0, 80)}`)
      .join('; ');
    const handoff = buildHandoff({
      task_id: state.initiativeId,
      initiative_id: state.initiativeId,
      journey_id: state.task?.payload?.journey_id || null,
      title: state.task?.title || '',
      verdict: computedVerdict,
      done: reconciledSubTasks
        .filter((s) => s.status === 'merged')
        .map((s) => `${s.id} 已合并${s.pr_url ? `: ${s.pr_url}` : ''}`),
      not_done: reconciledSubTasks
        .filter((s) => s.status !== 'merged')
        .map((s) => `${s.id}(status=${s.status || 'unknown'}${s.ci_fail_type ? `,ci=${s.ci_fail_type}` : ''})`),
      next_steps: computedVerdict === 'PASS'
        ? ['本 ability 已验收，golden_path 已冻结（A3）；下一 sprint 可加厚本 ability 或推进本 line 下一个 ability']
        : [`修复后重试${failDetail ? `。失败摘要：${failDetail.slice(0, 180)}` : ''}`],
      artifacts: {
        pr_urls: reconciledSubTasks.map((s) => s.pr_url).filter(Boolean),
        sprint_dir: state.sprintDir || null,
        branch: null,
        docs: [],
      },
    });
    await saveHandoff({ pool: dbPool }, handoff);
  } catch (err) {
    console.warn(`[reportNode] handoff generation failed (non-fatal): ${err.message}`);
  }
```

- [ ] **Step 5: 跑 wiring + 既有 promote wiring 回归**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/harness-handoff-wiring.test.js src/__tests__/harness-promote-wiring.test.js`
Expected: 全 PASS（既有 A3 接线不回归）

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/__tests__/harness-handoff-wiring.test.js
git commit -m "feat(brain): reportNode 终态自动产 handoff 交接单（方案B B-2）"
```

---

### Task 4: planner 加载点接线（B-3，TDD）

**Files:**
- Modify: `packages/brain/src/__tests__/harness-handoff-wiring.test.js`（追加 planner 用例）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（runPlannerNode，runHistoryText 块之后）

- [ ] **Step 1: 追加 failing test（同文件；runPlannerNode 走 spawn 路径，断言 spawnDetached 收到的 prompt）**

```js
// 追加 import：
import { runPlannerNode } from '../workflows/harness-initiative.graph.js';

describe('runPlannerNode handoff 注入', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function plannerState() {
    return {
      initiativeId: INIT_ID,
      task: { id: INIT_ID, title: 't', payload: { journey_id: 'j1', sprint_dir: 'sprints/x' } },
      worktreePath: '/tmp/wt',
    };
  }

  it('有 handoff 时 prompt 含注入段', async () => {
    getRecentMock.mockResolvedValueOnce([{ id: 'prev', title: 'p', handoff: { verdict: 'PASS' } }]);
    formatMock.mockReturnValueOnce('\n\n## 最近 Handoff（本 line 交接）\n### Handoff 1: p（verdict=PASS）');
    const spawnDetached = vi.fn(async () => ({}));
    await runPlannerNode(plannerState(), { spawnDetached, pool: makePool() }).catch(() => {});
    expect(getRecentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ journeyId: 'j1', excludeTaskId: INIT_ID }));
    expect(spawnDetached).toHaveBeenCalled();
    expect(spawnDetached.mock.calls[0][0].prompt).toContain('## 最近 Handoff');
  });

  it('getRecentHandoffs 抛错 → spawn 照常，prompt 无注入段', async () => {
    getRecentMock.mockRejectedValueOnce(new Error('db down'));
    const spawnDetached = vi.fn(async () => ({}));
    await runPlannerNode(plannerState(), { spawnDetached, pool: makePool() }).catch(() => {});
    expect(spawnDetached).toHaveBeenCalled();
    expect(spawnDetached.mock.calls[0][0].prompt).not.toContain('## 最近 Handoff');
  });
});
```

> 注意：runPlannerNode 内部会走 interrupt()（mock 返回 undefined）→ 之后代码可能返回 error 对象或抛错，测试用 `.catch(() => {})` 吞掉——断言目标只是 spawnDetached 收到的 prompt。若 runPlannerNode 在 spawn 前有其他依赖未 mock 导致提前抛错（spawnDetached 未被调），按报错补对应 vi.mock，不改生产代码。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/harness-handoff-wiring.test.js`
Expected: planner 两用例 FAIL（prompt 不含注入段 / getRecentMock 未被调）

- [ ] **Step 3: commit failing test**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/__tests__/harness-handoff-wiring.test.js
git commit -m "test(brain): plannerNode handoff 注入失败测试（方案B B-3）"
```

- [ ] **Step 4: runPlannerNode 注入（`runHistoryText` try/catch 块之后、`const plannerPromptFinal = ...` 处）**

把原来这一行：

```js
  const plannerPromptFinal = runHistoryText ? `${prompt}${runHistoryText}` : prompt;
```

替换为：

```js
  // 方案B（handoff 自动化，2026-07-02）：注入本 journey 最近交接单（失败不阻塞，与 runHistoryText 同纪律）
  let handoffText = '';
  try {
    const journeyId = state.task?.payload?.journey_id;
    if (journeyId) {
      const { getRecentHandoffs, formatHandoffsForPrompt } = await import('../handoff.js');
      const handoffRows = await getRecentHandoffs({ pool: dbPool }, {
        journeyId,
        limit: 3,
        excludeTaskId: state.task?.id || null,
      });
      handoffText = formatHandoffsForPrompt(handoffRows);
    }
  } catch (err) {
    console.warn(`[harness-initiative] fetchHandoffs failed (non-blocking): ${err.message}`);
  }
  const plannerPromptFinal = [prompt, runHistoryText, handoffText].filter(Boolean).join('');
```

- [ ] **Step 5: 全量相关测试**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && npx vitest run src/__tests__/handoff.test.js src/__tests__/harness-handoff-wiring.test.js src/__tests__/harness-promote-wiring.test.js`
Expected: 全 PASS

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/__tests__/harness-handoff-wiring.test.js
git commit -m "feat(brain): plannerNode 注入本 journey 最近 handoff（方案B B-3）"
```

---

### Task 5: real-env smoke 脚本

**Files:**
- Create: `packages/brain/scripts/smoke/handoff-smoke.sh`

- [ ] **Step 1: 写脚本（真 DB 临时行 + trap 清理 + 临时镜像目录，绝不动真实任务行）**

```bash
#!/usr/bin/env bash
# handoff-smoke.sh — 方案B handoff 真环境冒烟：
# 真 DB 插临时任务行 → node 调 buildHandoff+saveHandoff → 查回 result.handoff →
# getRecentHandoffs 命中 → trap 清理临时行。镜像目录用 mktemp（不污染 docs/handoffs）。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain

PSQL="${PSQL:-psql -h localhost -p 5432 -U postgres -d cecelia -tA}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SMOKE_ID="eeeeeeee-0000-4000-8000-$(date +%H%M%S)000000"
SMOKE_JOURNEY="eeeeeeee-0000-4000-8000-000000000001"
export HANDOFF_DOCS_DIR="$(mktemp -d)"

cleanup() {
  $PSQL -c "DELETE FROM tasks WHERE id='${SMOKE_ID}';" >/dev/null 2>&1 || true
  rm -rf "$HANDOFF_DOCS_DIR"
}
trap cleanup EXIT

echo "[1/4] 插入临时任务行 ${SMOKE_ID}"
$PSQL -c "INSERT INTO tasks (id, title, status, task_type, completed_at, payload)
  VALUES ('${SMOKE_ID}', '[SMOKE] handoff', 'completed', 'dev', NOW(),
          '{\"journey_id\":\"${SMOKE_JOURNEY}\"}'::jsonb);" >/dev/null

echo "[2/4] node 调 buildHandoff + saveHandoff"
node --input-type=module -e "
import { buildHandoff, saveHandoff } from './src/handoff.js';
import pg from 'pg';
const pool = new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'cecelia' });
const h = buildHandoff({ task_id: '${SMOKE_ID}', journey_id: '${SMOKE_JOURNEY}', title: 'smoke', verdict: 'PASS', done: ['smoke done'] });
const r = await saveHandoff({ pool }, h);
if (!r.dbWritten) { console.error('dbWritten=false'); process.exit(1); }
if (!r.mirrorPath) { console.error('mirrorPath=null'); process.exit(1); }
await pool.end();
console.log('saved, mirror=' + r.mirrorPath);
"

echo "[3/4] 查回 result.handoff"
GOT=$($PSQL -c "SELECT result->'handoff'->>'verdict' FROM tasks WHERE id='${SMOKE_ID}';")
[ "$GOT" = "PASS" ] || { echo "FAIL: verdict=$GOT"; exit 1; }

echo "[4/4] getRecentHandoffs 命中"
node --input-type=module -e "
import { getRecentHandoffs } from './src/handoff.js';
import pg from 'pg';
const pool = new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'cecelia' });
const rows = await getRecentHandoffs({ pool }, { journeyId: '${SMOKE_JOURNEY}', limit: 3 });
await pool.end();
if (rows.length < 1 || rows[0].handoff?.verdict !== 'PASS') { console.error('recent handoffs miss'); process.exit(1); }
console.log('hit: ' + rows.length);
"

echo "✅ handoff-smoke 全过"
```

- [ ] **Step 2: 本机真跑**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && bash scripts/smoke/handoff-smoke.sh`
Expected: `✅ handoff-smoke 全过`，且 `psql -c "SELECT count(*) FROM tasks WHERE title='[SMOKE] handoff'"` 为 0（trap 清理生效）

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
chmod +x packages/brain/scripts/smoke/handoff-smoke.sh
git add packages/brain/scripts/smoke/handoff-smoke.sh
git commit -m "test(brain): handoff 真环境冒烟脚本（临时行+trap 清理）"
```

---

### Task 6: 版本 bump + DevGate + 全量回归

**Files:**
- Modify: `packages/brain/package.json`（version patch bump，如 1.237.0 → 1.237.1；以文件当前值为准）
- Modify: `packages/brain/package-lock.json`、根 `package-lock.json`（workspace 引用）、`.brain-versions`、`DEFINITION.md`（若含版本行）

- [ ] **Step 1: bump 四处版本**

先看当前版本：`node -p "require('/Users/administrator/worktrees/cecelia/handoff-automation/packages/brain/package.json').version"`，patch +1，然后逐处改（Edit 工具改 4 个文件的版本字符串；`npm install --package-lock-only` 在 packages/brain 和根目录各跑一次同步 lock）。

- [ ] **Step 2: DevGate 三连**

Run（worktree 根）:
```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs 2>/dev/null || node packages/engine/scripts/devgate/check-dod-purity.cjs
```
Expected: 全过（check-dod 脚本名以 repo 实际存在者为准）

- [ ] **Step 3: brain 全量单测 + 语法冒烟**

Run: `cd /Users/administrator/worktrees/cecelia/handoff-automation/packages/brain && node --check server.js && npx vitest run 2>&1 | tail -5`
Expected: 语法 OK；测试全绿（若有与本改动无关的既有失败，记录并对照 main 分支同样失败才可放行）

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/handoff-automation
git add packages/brain/package.json packages/brain/package-lock.json package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): version bump — handoff 自动化（方案B）"
```

---

### Task 7: 收尾（finishing 阶段执行，此处仅列 DoD 素材）

PR 标题：`feat(brain): handoff 自动化 — 任务终态交接单 + planner 自动加载（方案B B1/B2/B3）`

PR body DoD（全部 CI 兼容）：
```
- [x] [BEHAVIOR] handoff 模块四导出齐全 — Test: manual: node -e "const s=require('fs').readFileSync('packages/brain/src/handoff.js','utf8'); ['buildHandoff','saveHandoff','getRecentHandoffs','formatHandoffsForPrompt'].forEach(f=>{if(!s.includes(f))process.exit(1)})"
- [x] [BEHAVIOR] reportNode 挂 handoff 生成点 — Test: manual: node -e "const s=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!s.includes(\"await import('../handoff.js')\")||!s.includes('handoff generation failed'))process.exit(1)"
- [x] [BEHAVIOR] plannerNode 挂 handoff 注入点 — Test: manual: node -e "const s=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!s.includes('fetchHandoffs failed'))process.exit(1)"
- [x] [BEHAVIOR] 单测覆盖 build/save/query/format + 双分支接线 + 异常不阻塞 — Test: tests/ 路径 packages/brain/src/__tests__/handoff.test.js + harness-handoff-wiring.test.js
- [x] [ARTIFACT] real-env 冒烟脚本 — packages/brain/scripts/smoke/handoff-smoke.sh（本机实跑通过）
```

合并后（watchdog 清理阶段）：
1. `bash scripts/brain-deploy.sh`（graph 是容器内代码，必须重建镜像才生效——feedback_brain_pull_before_reload）
2. 回写 Brain 任务 dcdbf10f → completed（含 pr_url）
```
