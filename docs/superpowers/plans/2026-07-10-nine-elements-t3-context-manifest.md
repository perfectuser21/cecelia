# 九要素 T3：注入扩容 + 蒸馏接线 + context-manifest 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三角色 prompt 注入扩容至 12000/50 并接入 line_ledger 蒸馏摘要，新增 warroom `GET /line/:id/context-manifest` 供 planner Step 0.4 一次拉全。

**Architecture:** 沿现有 harness-line-context best-effort 模式加第四路 ledger 查询（design_docs type='line_ledger'）；formatLineContextForPrompt 新增 ledger 段排最后（clamp 优先牺牲 ledger 保 E1 契约段）；line-dreaming buildLineDreamData 参数化 since 向后兼容；warroom 端点组装 ledger + 增量事实 + invariants + 累积FR。

**Tech Stack:** Node.js ESM + express + pg pool + vitest（mock pool / supertest）。

Spec: docs/superpowers/specs/2026-07-10-nine-elements-t3-context-manifest-design.md

---

### Task 1: harness-line-context 扩容 + ledger 段

**Files:**
- Modify: `packages/brain/src/harness-line-context.js`
- Test: `packages/brain/src/__tests__/harness-line-context.test.js`

- [ ] **Step 1: 写 failing test（改常量相关旧断言 + 新增 ledger 用例）**

对 `packages/brain/src/__tests__/harness-line-context.test.js` 做以下修改：

1. import 增加 `LINE_LEDGER_SECTION_HEADER`：
```js
import {
  fetchLineContext,
  formatLineContextForPrompt,
  fetchAndFormatLineContext,
  INVARIANT_SECTION_HEADER,
  LINE_LEDGER_SECTION_HEADER,
} from '../harness-line-context.js';
```

2. `makePool` 参数加 `ledger = null`，SQL 路由**在 `unexpected SQL` throw 之前**加一条（注意放在 `/JOIN journey_features jf/` 分支之后）：
```js
      if (/FROM design_docs/.test(sql)) {
        if (fail.ledger) throw new Error('ledger query down');
        return { rows: ledger ? [ledger] : [] };
      }
```

3. 旧断言更新（4 处）：
   - `'三参齐全 → 发 4 路查询'` 用例：`toHaveBeenCalledTimes(4)` → `5`，用例名改 `'三参齐全 → 发 5 路查询…'`
   - `'参数缺省跳过对应路：全缺省只查 area，一次查询'`：期望改 `expect(r).toEqual({ invariants: [], cumulativeFR: [], ledger: null })`
   - `'全路失败'` 用例：`fail: { step: true, feature: true, area: true, fr: true, ledger: true }`，期望 `expect(r).toEqual({ invariants: [], cumulativeFR: [], ledger: null })`，`toHaveBeenCalledTimes(4)` → `5`
   - `'>20 个 ability 截断并加注'` → 改名 `'>50 个 ability 截断并加注'`，构造 55 个，断言 `frLines).toHaveLength(50)` 与 `'另有 5 个 ability 略'`
   - `'总长兜底 ≤4000 字截断'` → 改名 `'总长兜底 ≤12000 字截断'`：invariants 改 100 条（100×约200字 > 12000），断言 `text.length).toBeLessThanOrEqual(12001)` 且 `expect(text.length).toBeGreaterThan(4001)`（证明不是旧 4000 上限）

4. 新增 describe：
```js
describe('line_ledger 蒸馏接线（T3）', () => {
  it('journeyId 存在 → 发 ledger 查询（design_docs type=line_ledger 最新一条），返回 {content, created_at}', async () => {
    const pool = makePool({ ledger: { content: '# X — 24h 账本\n## 决策\n- 拍板A', created_at: '2026-07-10T21:00:00Z' } });
    const r = await fetchLineContext({ pool }, { journeyId: JOURNEY_ID });
    const call = findCall(pool, /FROM design_docs/);
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/type='line_ledger'/);
    expect(sql).toMatch(/journey_id=\$1/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(params).toEqual([JOURNEY_ID]);
    expect(r.ledger).toEqual({ content: '# X — 24h 账本\n## 决策\n- 拍板A', created_at: '2026-07-10T21:00:00Z' });
  });

  it('journeyId 缺省 → 不发 ledger 查询，ledger=null', async () => {
    const pool = makePool();
    const r = await fetchLineContext({ pool }, { abilityId: ABILITY_ID });
    expect(findCall(pool, /FROM design_docs/)).toBeUndefined();
    expect(r.ledger).toBeNull();
  });

  it('ledger 查询失败 → ledger=null + warn，其余路不受影响', async () => {
    const pool = makePool({
      area: [{ id: 'd9', topic: '[全局]租户隔离', decision: '按租户隔离' }],
      fail: { ledger: true },
    });
    const r = await fetchLineContext({ pool }, { journeyId: JOURNEY_ID });
    expect(r.ledger).toBeNull();
    expect(r.invariants).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('format：有 ledger 出段且排最后，内容 clamp 4000', () => {
    const text = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[X]a', decision: 'b', source_level: 'area' }],
      cumulativeFR: [],
      ledger: { content: 'L'.repeat(5000), created_at: '2026-07-10T21:00:00Z' },
    });
    expect(text).toContain(LINE_LEDGER_SECTION_HEADER);
    expect(text.indexOf(LINE_LEDGER_SECTION_HEADER)).toBeGreaterThan(text.indexOf(INVARIANT_SECTION_HEADER));
    expect(text).toContain('L'.repeat(4000) + '…');
    expect(text).not.toContain('L'.repeat(4001));
  });

  it('format：无 ledger（null/缺字段）不出段，且不影响旧两段输出', () => {
    const noLedger = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[X]a', decision: 'b', source_level: 'area' }],
      cumulativeFR: [],
      ledger: null,
    });
    expect(noLedger).not.toContain(LINE_LEDGER_SECTION_HEADER);
    expect(noLedger).toContain(INVARIANT_SECTION_HEADER);
  });

  it('format：只有 ledger 也成段（三段皆空才返回 ""）', () => {
    const onlyLedger = formatLineContextForPrompt({
      invariants: [], cumulativeFR: [],
      ledger: { content: '# 账本', created_at: 'x' },
    });
    expect(onlyLedger).toContain(LINE_LEDGER_SECTION_HEADER);
    expect(onlyLedger).toContain('# 账本');
    expect(formatLineContextForPrompt({ invariants: [], cumulativeFR: [], ledger: null })).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-line-context.test.js`
Expected: FAIL（LINE_LEDGER_SECTION_HEADER 未导出 / 5 路查询不成立 / 12000 断言失败）

- [ ] **Step 3: commit-1（failing test）**

```bash
git add packages/brain/src/__tests__/harness-line-context.test.js
git commit -m "test(brain/T3): harness-line-context 12000/50 扩容 + ledger 段注入 failing tests"
```

- [ ] **Step 4: 实现**

`packages/brain/src/harness-line-context.js`：

常量区改为：
```js
const MAX_INVARIANT_LEN = 200;   // 单条铁律文字截断
const MAX_FR_LINE_LEN = 120;     // 累积 FR 单行截断
const MAX_FR_ABILITIES = 50;     // 累积 FR 最多列 50 个 ability，超出加注（T3 扩容）
const PROMPT_MAX_LEN = 12000;    // 总长兜底截断（T3 扩容 4000→12000）
const MAX_LEDGER_LEN = 4000;     // line_ledger 摘要段内容截断
```

段头常量区追加：
```js
export const LINE_LEDGER_SECTION_HEADER = '## Line 账本（昨日蒸馏摘要）';
```

`fetchLineContext` 内，`cumulativeFR` 块之后、`return` 之前追加：
```js
  // line_ledger 蒸馏摘要（T3 接线）：dreaming L1 每晚落 design_docs(type='line_ledger')，取最新一条
  let ledger = null;
  if (journeyId) {
    const ledgerRows = await safeQuery('line ledger', `
      SELECT content, created_at FROM design_docs
      WHERE type='line_ledger' AND journey_id=$1
      ORDER BY created_at DESC LIMIT 1`, [journeyId]);
    if (ledgerRows[0]?.content) {
      ledger = { content: ledgerRows[0].content, created_at: ledgerRows[0].created_at };
    }
  }

  return { invariants, cumulativeFR, ledger };
```
（删掉原 `return { invariants, cumulativeFR };`）

`formatLineContextForPrompt` 在 FR 段 push 之后、`if (!sections.length)` 之前追加（ledger 排最后，总长 clamp 时优先牺牲本段保 E1 契约两段）：
```js
  if (ctx?.ledger?.content) {
    sections.push([LINE_LEDGER_SECTION_HEADER, clamp(ctx.ledger.content, MAX_LEDGER_LEN)].join('\n'));
  }
```

文件头注释第 6-11 行块补一句（在 fetchLineContext 描述内）：`+ 最新 line_ledger 蒸馏摘要（design_docs，T3 接线）`。

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-line-context.test.js src/__tests__/harness-line-context-wiring.test.js`
Expected: PASS 全部

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/harness-line-context.js
git commit -m "feat(brain/T3): 注入扩容 12000/50 + line_ledger 蒸馏摘要段注入"
```

---

### Task 2: line-dreaming buildLineDreamData 参数化 since

**Files:**
- Modify: `packages/brain/src/line-dreaming.js:76-150`
- Test: `packages/brain/src/__tests__/line-dreaming.test.js`

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/__tests__/line-dreaming.test.js` 的 buildLineDreamData 相关 describe 末尾（若无则新建 describe）追加。先读该文件确认现有 mock pool 写法后按同风格写：

```js
describe('buildLineDreamData since 参数（T3）', () => {
  it('传 since → 六段 SQL 均带 COALESCE($2::timestamptz, ...) 且参数含 since 值', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push([sql, params]); return { rows: [] }; }) };
    const since = '2026-07-09T21:00:00Z';
    await buildLineDreamData(pool, 'j1', 'LineX', { since });
    expect(calls).toHaveLength(6);
    for (const [sql, params] of calls) {
      expect(sql).toMatch(/COALESCE\(\$\d::timestamptz, NOW\(\) - INTERVAL '24 hours'\)/);
      expect(params).toContain(since);
    }
  });

  it('不传 since → 参数位为 null（COALESCE 回落 24h，与旧行为一致）', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push([sql, params]); return { rows: [] }; }) };
    const data = await buildLineDreamData(pool, 'j1', 'LineX');
    expect(calls).toHaveLength(6);
    for (const [, params] of calls) expect(params).toContain(null);
    expect(data).toEqual({
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
  });
});
```

（import 处确认已含 `buildLineDreamData`，无则加。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: 新增用例 FAIL（SQL 无 COALESCE / 参数无 null）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "test(brain/T3): buildLineDreamData since 参数 failing tests"
```

- [ ] **Step 4: 实现**

`line-dreaming.js` 的 `buildLineDreamData` 签名改：
```js
export async function buildLineDreamData(pool, journeyId, journeyName, { since = null } = {}) {
```
六段查询逐个改：时间条件 `>= NOW() - INTERVAL '24 hours'` 全部替换为 `>= COALESCE($2::timestamptz, NOW() - INTERVAL '24 hours')`，params 由 `[journeyId]` 改 `[journeyId, since]`；军师留痕段（title LIKE $1 那段）时间条件用 `$2`，params `[
`军师决策[${journeyName}]%`, since]`。JSDoc 补 `@param {{since?: string|Date|null}} [opts]`。

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/line-dreaming.test.js`
Expected: PASS 全部（含既有用例——若既有用例硬断言旧 SQL 文本导致失败，按新 SQL 更新断言，行为语义不变）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/line-dreaming.js packages/brain/src/__tests__/line-dreaming.test.js
git commit -m "feat(brain/T3): buildLineDreamData 支持 since 参数（默认 24h 向后兼容）"
```

---

### Task 3: warroom GET /line/:id/context-manifest

**Files:**
- Modify: `packages/brain/src/routes/warroom.js`
- Test: `packages/brain/src/routes/__tests__/warroom-context-manifest.test.js`（新建）

- [ ] **Step 1: 写 failing test（新文件）**

```js
/**
 * warroom-context-manifest.test.js — GET /warroom/line/:id/context-manifest（T3）
 * mock db + mock harness-line-context/line-dreaming，验组装逻辑与降级。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockFetchLineContext = vi.hoisted(() => vi.fn());
vi.mock('../../harness-line-context.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, fetchLineContext: mockFetchLineContext };
});

const mockBuildLineDreamData = vi.hoisted(() => vi.fn());
vi.mock('../../line-dreaming.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, buildLineDreamData: mockBuildLineDreamData };
});

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../warroom.js');
  router = mod.default;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/warroom', router);
  return a;
}

const JID = 'ffffffff-0000-1111-2222-333333333333';
const LEDGER = { content: '# X — 24h 账本', created_at: '2026-07-10T21:00:00.000Z' };
const DELTA = { decisions: [], advancementItems: [{ id: 'a1', title: '推进项', status: 'doing' }], issues: [], runs: [], learnings: [], strategistNotes: [] };

describe('GET /warroom/line/:id/context-manifest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200：line + ledger + delta + invariants + cumulative_fr + prompt_block', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: 'skeleton' }] });
    mockFetchLineContext.mockResolvedValueOnce({
      invariants: [{ id: 'd1', topic: '[X]a', decision: 'b', source_level: 'area' }],
      cumulativeFR: [{ ability_name: '发视频', steps: [{ order_no: 1, note: 'x' }] }],
      ledger: LEDGER,
    });
    mockBuildLineDreamData.mockResolvedValueOnce(DELTA);

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.line).toMatchObject({ id: JID, name: 'LineX', status: 'active', maturity: 'skeleton' });
    expect(res.body.ledger).toEqual(LEDGER);
    expect(res.body.delta.advancement_items).toHaveLength(1);
    expect(res.body.invariants).toHaveLength(1);
    expect(res.body.cumulative_fr).toHaveLength(1);
    expect(res.body.prompt_block).toContain('## Invariant 约束');
    expect(res.body.generated_at).toBeTruthy();
    // delta 窗口 = 自 ledger 时刻起
    expect(mockBuildLineDreamData).toHaveBeenCalledWith(
      expect.anything(), JID, 'LineX', { since: LEDGER.created_at }
    );
    // fetchLineContext 只带 journeyId（line 级 manifest 无 task/ability 上下文）
    expect(mockFetchLineContext).toHaveBeenCalledWith(
      expect.objectContaining({ pool: expect.anything() }), { journeyId: JID }
    );
  });

  it('无 ledger → ledger:null，delta 回落 since:null（buildLineDreamData 内部 24h）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: null }] });
    mockFetchLineContext.mockResolvedValueOnce({ invariants: [], cumulativeFR: [], ledger: null });
    mockBuildLineDreamData.mockResolvedValueOnce(DELTA);

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.ledger).toBeNull();
    expect(res.body.prompt_block).toBe('');
    expect(mockBuildLineDreamData).toHaveBeenCalledWith(expect.anything(), JID, 'LineX', { since: null });
  });

  it('journey 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('journey not found');
  });

  it('delta 查询炸 → delta 六段空数组降级，仍 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: null }] });
    mockFetchLineContext.mockResolvedValueOnce({ invariants: [], cumulativeFR: [], ledger: null });
    mockBuildLineDreamData.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.delta).toEqual({
      decisions: [], advancement_items: [], issues: [], runs: [], learnings: [], strategist_notes: [],
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/warroom-context-manifest.test.js`
Expected: FAIL（404 route not found / 结构不符）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/routes/__tests__/warroom-context-manifest.test.js
git commit -m "test(brain/T3): warroom context-manifest 端点 failing tests"
```

- [ ] **Step 4: 实现**

`packages/brain/src/routes/warroom.js`：

顶部 import 区追加：
```js
import { fetchLineContext, formatLineContextForPrompt } from '../harness-line-context.js';
import { buildLineDreamData } from '../line-dreaming.js';
```

在 `/line/:id/command` 端点之后、`export default router;` 之前追加：
```js
/**
 * GET /api/brain/warroom/line/:id/context-manifest
 *   planner Step 0.4 一次拉全（九要素 T3）：
 *   - ledger: 最新 line_ledger 蒸馏摘要（design_docs，dreaming L1 每晚产出）
 *   - delta: 自 ledger 时刻起的六段增量事实（无 ledger 回落 24h 窗口）
 *   - invariants / cumulative_fr: 与三角色注入同源（fetchLineContext）
 *   - prompt_block: formatLineContextForPrompt 直出，skill 可整段注入
 */
router.get('/line/:id/context-manifest', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: jrows } = await pool.query(
      `SELECT id, name, status, maturity FROM journeys WHERE id = $1`,
      [id]
    );
    if (jrows.length === 0) return res.status(404).json({ error: 'journey not found' });
    const journey = jrows[0];

    const ctx = await fetchLineContext({ pool }, { journeyId: journey.id });

    let delta;
    try {
      delta = await buildLineDreamData(pool, journey.id, journey.name, {
        since: ctx.ledger?.created_at ?? null,
      });
    } catch (e) {
      console.warn('[warroom] context-manifest delta failed (non-fatal):', e.message);
      delta = { decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [] };
    }

    res.json({
      line: {
        id: journey.id,
        name: journey.name,
        status: journey.status,
        maturity: journey.maturity,
      },
      ledger: ctx.ledger ?? null,
      delta: {
        decisions: delta.decisions,
        advancement_items: delta.advancementItems,
        issues: delta.issues,
        runs: delta.runs,
        learnings: delta.learnings,
        strategist_notes: delta.strategistNotes,
      },
      invariants: ctx.invariants,
      cumulative_fr: ctx.cumulativeFR,
      prompt_block: formatLineContextForPrompt(ctx),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /warroom/line/:id/context-manifest]', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/`
Expected: PASS 全部（含既有 warroom 测试不回归）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/routes/warroom.js
git commit -m "feat(brain/T3): warroom 新增 GET /line/:id/context-manifest 供 planner Step0.4 一次拉全"
```

---

### Task 4: 收尾 — wiring 注释清理 + 版本 bump + DevGate + DoD

**Files:**
- Modify: `packages/brain/src/__tests__/harness-line-context-wiring.test.js`（头注释过时引用）
- Modify: `packages/brain/package.json` / 根 `package-lock.json` / `.brain-versions` / `DEFINITION.md`（版本四处）
- Create: `sprints/07102317-nine-elements-t3-context-manifest/DOD.md`

- [ ] **Step 1: wiring test 头注释清理**

读 `packages/brain/src/__tests__/harness-line-context-wiring.test.js:1-10`，把注释中对已删除 `harness-task.graph.js`（generator/evaluator 注入点）的过时描述改为现状：仅 `harness-gan.graph.js` proposer 单点注入。不改任何断言逻辑。

- [ ] **Step 2: 版本 bump 四处（minor：新端点+新能力）**

当前 1.247.0 → 1.248.0：
```bash
# package.json
node -e "const f='packages/brain/package.json';const p=require('./'+f);p.version='1.248.0';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
# package-lock.json（根锁文件里 packages/brain 两处）
node -e "const f='package-lock.json';const p=require('./'+f);p.packages['packages/brain'].version='1.248.0';if(p.packages['node_modules/@cecelia/brain'])p.packages['node_modules/@cecelia/brain'].version='1.248.0';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
# .brain-versions 与 DEFINITION.md：查看现有格式后同步 1.248.0
grep -n "1.247.0" .brain-versions DEFINITION.md
# 按 grep 结果用 Edit 把两处 1.247.0 → 1.248.0
bash scripts/check-version-sync.sh
```
Expected: check-version-sync.sh 通过

- [ ] **Step 3: 写 DoD**

`sprints/07102317-nine-elements-t3-context-manifest/DOD.md`：
```markdown
# DoD：九要素T3 注入扩容+蒸馏接线

- [x] [BEHAVIOR] formatLineContextForPrompt 总长上限 12000、FR 上限 50、有 ledger 时注入蒸馏摘要段
  - Test: tests/ packages/brain/src/__tests__/harness-line-context.test.js
- [x] [BEHAVIOR] buildLineDreamData 支持 since 参数，缺省行为与 24h 窗口一致
  - Test: tests/ packages/brain/src/__tests__/line-dreaming.test.js
- [x] [BEHAVIOR] GET /api/brain/warroom/line/:id/context-manifest 返回 ledger+delta+invariants+cumulative_fr+prompt_block；journey 不存在 404；delta 失败降级空段
  - Test: tests/ packages/brain/src/routes/__tests__/warroom-context-manifest.test.js
- [x] 版本 bump 1.248.0 四处同步（check-version-sync.sh 通过）
- [x] CI 全绿
```

- [ ] **Step 4: DevGate 三连 + brain 相关测试全跑**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
cd packages/brain && npx vitest run src/__tests__/harness-line-context.test.js src/__tests__/harness-line-context-wiring.test.js src/__tests__/line-dreaming.test.js src/routes/__tests__/ && node --check src/server.js
```
Expected: 全部通过（注意：不跑 brain 全量 vitest——环境级 OOM，见 memory fix-escalation-silent-cancel-postmortem）

- [ ] **Step 5: commit**

```bash
git add -A
git commit -m "chore(brain/T3): wiring 注释清理 + 版本 1.248.0 四处同步 + DoD"
```

---

## Self-Review 记录

- Spec 覆盖：spec §1→Task1、§2→Task2、§3→Task3、版本/测试策略→Task4 ✅
- 无占位符；类型/命名一致（ledger:{content,created_at}、delta snake_case 对外/camelCase 内部映射已显式写出）✅
- 已知风险已编码：ledger 段排最后保 E1 契约；line-dreaming 既有测试若硬断言旧 SQL 文本，Task2 Step5 已授权按语义更新
