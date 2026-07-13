# GP4 direction-proposer 每周方向菜单 job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每周一北京 05:30 聚合 OKR 缺口/推进项耗尽/直投池，经一次 LLM 汇总写 golden_paths candidate + working_memory 缺口全景（GP loop T4，DoD F11）。

**Architecture:** 单文件 scheduler job（照 line-dreaming.js 骨架：窗口 gate + 20h 去重 + 确定性聚合 + 可注入 LLM + 降级），在 scheduler-jobs.js 登记一行。不建新 task_type（理由见 spec）。

**Tech Stack:** Node.js ESM + pg pool + callLLM('thalamus') + vitest mock-pool 单测。

**Spec:** `docs/superpowers/specs/2026-07-12-gp4-direction-proposer-design.md`

---

### Task 1: json-utils 共享提取（重复 3 次规则）

`extractJsonObject` 已在 capture-triage.js:67 与 invariant-gate.js:32 重复两份，本次第三个使用者出现 → 提取共享。

**Files:**
- Create: `packages/brain/src/json-utils.js`
- Create: `packages/brain/src/__tests__/json-utils.test.js`
- Modify: `packages/brain/src/capture-triage.js`（删私有实现改 import）
- Modify: `packages/brain/src/invariant-gate.js`（同上）

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/json-utils.test.js
import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../json-utils.js';

describe('extractJsonObject', () => {
  it('纯 JSON 对象直接解析', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it('裹在文字里的 JSON 提取首个对象', () => {
    expect(extractJsonObject('前言\n{"route":"okr"}\n后记')).toEqual({ route: 'okr' });
  });
  it('顶层数组不算对象 → null', () => {
    expect(extractJsonObject('[1,2]')).toBeNull();
  });
  it('不可解析 → null', () => {
    expect(extractJsonObject('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/json-utils.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 + 两处旧模块改 import**

```js
// packages/brain/src/json-utils.js
/** 从 LLM 输出文本提取首个 JSON 对象；纯 JSON / 夹杂文字均可；解析失败或非对象返回 null。 */
export function extractJsonObject(text) {
  try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
```

capture-triage.js：删 67-72 行私有函数，顶部加 `import { extractJsonObject } from './json-utils.js';`
invariant-gate.js：删 32-37 行（`function extractJsonObject` 整段），顶部加同一 import。

- [ ] **Step 4: 跑新测试 + 两个旧模块测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/json-utils.test.js src/__tests__/capture-triage.test.js src/__tests__/invariant-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/json-utils.js packages/brain/src/__tests__/json-utils.test.js packages/brain/src/capture-triage.js packages/brain/src/invariant-gate.js
git commit -m "refactor(brain): extractJsonObject 提取共享 json-utils（第3处使用者出现，重复3次规则）"
```

---

### Task 2: direction-proposer 失败测试先行（commit-1 Red）

**Files:**
- Create: `packages/brain/src/__tests__/direction-proposer.test.js`

- [ ] **Step 1: 写完整失败测试**

```js
// packages/brain/src/__tests__/direction-proposer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInDirectionProposerWindow,
  alreadyProposedThisWeek,
  collectKrGaps,
  collectExhaustedLines,
  getDirectCandidates,
  proposeCandidates,
  insertCandidates,
  writeGapPanorama,
  maybeRunDirectionProposer,
} from '../direction-proposer.js';

beforeEach(() => vi.clearAllMocks());

// 便捷：按 SQL 片段路由的 mock pool
function mockPool(routes) {
  return {
    query: vi.fn(async (sql, params) => {
      for (const [pattern, result] of routes) {
        if (sql.includes(pattern)) return typeof result === 'function' ? result(sql, params) : result;
      }
      return { rows: [] };
    }),
  };
}

describe('isInDirectionProposerWindow — UTC 周日 21:30-21:35 = 北京周一 05:30-05:35', () => {
  it('周日 UTC 21:29 → false', () => {
    // 2026-07-12 是周日
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 29)))).toBe(false);
  });
  it('周日 UTC 21:30 → true', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 30)))).toBe(true);
  });
  it('周日 UTC 21:34 → true', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 34)))).toBe(true);
  });
  it('周日 UTC 21:35 → false', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 12, 21, 35)))).toBe(false);
  });
  it('周一 UTC 21:30（北京周二）→ false', () => {
    expect(isInDirectionProposerWindow(new Date(Date.UTC(2026, 6, 13, 21, 30)))).toBe(false);
  });
});

describe('alreadyProposedThisWeek — working_memory gp_gap_panorama 20h 内已更新 → true', () => {
  it('有记录 → true，SQL 含 gp_gap_panorama/20 hours', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyProposedThisWeek(pool)).resolves.toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/gp_gap_panorama/);
    expect(sql).toMatch(/20 hours/);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyProposedThisWeek(pool)).resolves.toBe(false);
  });
});

describe('collectKrGaps — 四类缺口 reason', () => {
  it('无 target_abilities → no_target_abilities', async () => {
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-1', title: 'KR一', metadata: {} }] }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' }]);
  });
  it('引用失联（含非 UUID）→ missing_refs', async () => {
    const abilityId = '11111111-1111-1111-1111-111111111111';
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-2', title: 'KR二', metadata: { target_abilities: [abilityId, 'not-a-uuid'] } }] }],
      ['FROM journey_features', { rows: [] }], // abilityId 查无此人
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-2', kr_title: 'KR二', reason: 'missing_refs' }]);
  });
  it('存在 thin ability → thin_ability', async () => {
    const abilityId = '22222222-2222-2222-2222-222222222222';
    const pool = mockPool([
      ['FROM key_results', { rows: [{ id: 'kr-3', title: 'KR三', metadata: { target_abilities: [abilityId] } }] }],
      ['FROM journey_features', { rows: [{ id: abilityId, thickness: 'thin', open: '0' }] }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-3', kr_title: 'KR三', reason: 'thin_ability' }]);
  });
  it('advancement 未完 → advancement_incomplete；全部完好 → 无缺口', async () => {
    const a1 = '33333333-3333-3333-3333-333333333333';
    const a2 = '44444444-4444-4444-4444-444444444444';
    const pool = mockPool([
      ['FROM key_results', { rows: [
        { id: 'kr-4', title: 'KR四', metadata: { target_abilities: [a1] } },
        { id: 'kr-5', title: 'KR五', metadata: { target_abilities: [a2] } },
      ] }],
      ['FROM journey_features', (sql, params) => {
        if (params[0][0] === a1) return { rows: [{ id: a1, thickness: 'medium', open: '2' }] };
        return { rows: [{ id: a2, thickness: 'thick', open: '0' }] };
      }],
    ]);
    const gaps = await collectKrGaps(pool);
    expect(gaps).toEqual([{ kr_id: 'kr-4', kr_title: 'KR四', reason: 'advancement_incomplete' }]);
  });
});

describe('collectExhaustedLines — active line 无 todo/doing 推进项 → 耗尽', () => {
  it('返回 id+name，SQL 含 NOT EXISTS/todo', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'j-1', name: '发布线' }] }) };
    await expect(collectExhaustedLines(pool)).resolves.toEqual([{ journey_id: 'j-1', journey_name: '发布线' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/todo/);
  });
});

describe('getDirectCandidates — 直投池（alex_direct/capture_triage 的 candidate）', () => {
  it('SQL 过滤 status=candidate + source 白名单', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'gp-1', title: '直投', one_liner: 'x', kr_id: null, journey_id: null }] }) };
    const rows = await getDirectCandidates(pool);
    expect(rows).toHaveLength(1);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/alex_direct/);
    expect(sql).toMatch(/capture_triage/);
  });
});

describe('proposeCandidates — 一次 LLM 汇总 + 降级', () => {
  const inputs = {
    gaps: [{ kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' }],
    exhausted: [{ journey_id: 'j-1', journey_name: '发布线' }],
    direct: [],
  };
  it('LLM 返回合法 JSON → 解析 candidates', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '{"candidates":[{"title":"新GP","one_liner":"一句话","kr_id":"kr-1","journey_id":null,"est_scale":"约1周"}]}' });
    const r = await proposeCandidates(llm, inputs);
    expect(r.llmFailed).toBe(false);
    expect(r.candidates).toEqual([{ title: '新GP', one_liner: '一句话', kr_id: 'kr-1', journey_id: null, est_scale: '约1周' }]);
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it('LLM 抛错 → 降级空候选 + llmFailed', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await proposeCandidates(llm, inputs);
    expect(r).toEqual({ candidates: [], llmFailed: true });
  });
  it('LLM 输出不可解析 → 降级', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '我觉得挺好' });
    const r = await proposeCandidates(llm, inputs);
    expect(r).toEqual({ candidates: [], llmFailed: true });
  });
  it('无缺口无耗尽 → 不调 LLM，直接空', async () => {
    const llm = vi.fn();
    const r = await proposeCandidates(llm, { gaps: [], exhausted: [], direct: [] });
    expect(r).toEqual({ candidates: [], llmFailed: false });
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('insertCandidates — 写 golden_paths(candidate, strategist) + 防重复', () => {
  it('新 title → INSERT source=strategist；重复活跃 title → skip', async () => {
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('SELECT 1 FROM golden_paths')) {
          return params[0] === '重复GP' ? { rows: [{ '?column?': 1 }] } : { rows: [] };
        }
        return { rows: [{ id: 'new-gp' }] };
      }),
    };
    const r = await insertCandidates(pool, [
      { title: '新GP', one_liner: 'x', kr_id: null, journey_id: null, est_scale: null },
      { title: '重复GP', one_liner: 'y', kr_id: null, journey_id: null, est_scale: null },
    ]);
    expect(r.inserted).toHaveLength(1);
    expect(r.skippedDuplicates).toBe(1);
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO golden_paths'));
    expect(insertCall[0]).toMatch(/strategist/);
  });
  it('非法 UUID 的 kr_id/journey_id 置 null 防炸批', async () => {
    const pool = {
      query: vi.fn(async (sql) =>
        sql.includes('SELECT 1 FROM golden_paths') ? { rows: [] } : { rows: [{ id: 'new-gp' }] }),
    };
    await insertCandidates(pool, [{ title: 'GP', one_liner: 'x', kr_id: 'kr-1（非UUID）', journey_id: 'bad', est_scale: null }]);
    const insertCall = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO golden_paths'));
    expect(insertCall[1][3]).toBeNull(); // kr_id
    expect(insertCall[1][2]).toBeNull(); // journey_id
  });
  it('单条 INSERT 失败不阻断其他条', async () => {
    let n = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT 1 FROM golden_paths')) return { rows: [] };
        n += 1;
        if (n === 1) throw new Error('fk violation');
        return { rows: [{ id: 'gp-ok' }] };
      }),
    };
    const r = await insertCandidates(pool, [
      { title: 'A', one_liner: 'x', kr_id: null, journey_id: null, est_scale: null },
      { title: 'B', one_liner: 'y', kr_id: null, journey_id: null, est_scale: null },
    ]);
    expect(r.inserted).toHaveLength(1);
    expect(r.failed).toBe(1);
  });
});

describe('writeGapPanorama — 并行约定 key=gp_gap_panorama', () => {
  it('upsert working_memory，gaps 只留未覆盖的', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const gaps = [
      { kr_id: 'kr-1', kr_title: 'KR一', reason: 'no_target_abilities' },
      { kr_id: 'kr-2', kr_title: 'KR二', reason: 'thin_ability' },
    ];
    await writeGapPanorama(pool, gaps, new Set(['kr-1']));
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/working_memory/);
    expect(sql).toMatch(/ON CONFLICT/);
    expect(params[0]).toBe('gp_gap_panorama');
    const value = JSON.parse(params[1]);
    expect(value.generated_at).toBeTruthy();
    expect(value.gaps).toEqual([{ kr_id: 'kr-2', kr_title: 'KR二', reason: 'thin_ability' }]);
  });
});

describe('maybeRunDirectionProposer — 主入口', () => {
  const inWindow = new Date(Date.UTC(2026, 6, 12, 21, 31));
  it('窗口外不触发', async () => {
    const pool = { query: vi.fn() };
    const r = await maybeRunDirectionProposer(pool, { now: new Date(Date.UTC(2026, 6, 12, 20, 0)) });
    expect(r.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('20h 内已跑 → skip', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const r = await maybeRunDirectionProposer(pool, { now: inWindow });
    expect(r).toMatchObject({ triggered: true, skipped: true });
  });
  it('happy path：聚合→LLM→写候选→写全景', async () => {
    const abilityId = '55555555-5555-5555-5555-555555555555';
    const pool = mockPool([
      ['gp_gap_panorama', { rows: [] }],
      ['FROM key_results', { rows: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'KR一', metadata: { target_abilities: [abilityId] } }] }],
      // 注意顺序：collectExhaustedLines 的子查询也含 FROM journey_features，NOT EXISTS 必须排前面先匹配
      ['NOT EXISTS', { rows: [] }],
      ['FROM journey_features', { rows: [{ id: abilityId, thickness: 'thin', open: '0' }] }],
      ['SELECT 1 FROM golden_paths', { rows: [] }],
      ['INSERT INTO golden_paths', { rows: [{ id: 'gp-new' }] }],
      ["source IN ('alex_direct', 'capture_triage')", { rows: [] }],
    ]);
    const llm = vi.fn().mockResolvedValue({ text: '{"candidates":[{"title":"补厚GP","one_liner":"x","kr_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","journey_id":null,"est_scale":"1周"}]}' });
    const r = await maybeRunDirectionProposer(pool, { now: inWindow, llm });
    expect(r).toMatchObject({ triggered: true, proposed: 1, gapsTotal: 1, gapsUncovered: 0, llmFailed: false });
    const upsert = pool.query.mock.calls.find(([sql]) => sql.includes('ON CONFLICT'));
    expect(JSON.parse(upsert[1][1]).gaps).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认全部失败（模块不存在）**

Run: `cd packages/brain && npx vitest run src/__tests__/direction-proposer.test.js`
Expected: FAIL（`../direction-proposer.js` 不存在）

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/direction-proposer.test.js
git commit -m "test(brain): GP4/T4 direction-proposer 失败测试先行——窗口/去重/三源聚合/LLM降级/写库"
```

---

### Task 3: direction-proposer 实现（commit-2 Green）

**Files:**
- Create: `packages/brain/src/direction-proposer.js`

- [ ] **Step 1: 完整实现**

```js
/**
 * direction-proposer.js — 每周方向菜单 job（GP loop T4，DoD F11）
 *
 * 每周一北京 05:30（UTC 周日 21:30，晨报前）聚合三源：
 *   1. 跨线 KR 缺口（复刻 GET /okr/kr/:id/ability-progress 对账逻辑，进程内直接查库）
 *   2. advancement_items todo 耗尽信号（active line 无 todo/doing 推进项）
 *   3. 直投池（golden_paths source='alex_direct'/'capture_triage' 的既有 candidate，一等公民）
 * 经一次 LLM 汇总生成候选写 golden_paths(status='candidate', source='strategist')，
 * 并把「OKR 缺口全景」写 working_memory key='gp_gap_panorama'
 * （value_json={generated_at, gaps:[{kr_id,kr_title,reason}]}，并行约定钉死，GP6 晨报从此 key 读）。
 *
 * 方式决策（decisions af10d497）：scheduler job 内联而非新 task_type——菜单生成 =
 * 确定性聚合 + 一次 LLM 汇总，无需完整 dev 会话；LLM 失败降级只写全景（确定性部分不丢）。
 * 不动 line-strategist 本体（其单线原子决策职权已冻结）。
 */
import { callLLM } from './llm-caller.js';
import { extractJsonObject } from './json-utils.js';

/** 每周触发窗口：UTC 周日 21:30-21:35 = 北京周一 05:30-05:35 */
const WINDOW_UTC_DAY = 0;
const WINDOW_UTC_HOUR = 21;
const WINDOW_UTC_MINUTE_START = 30;
const WINDOW_UTC_MINUTE_END = 35;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 与 GP6 晨报渲染的并行约定：全景只从这个 key 读 */
export const GAP_PANORAMA_KEY = 'gp_gap_panorama';
/** 单次最多产出候选数（菜单是给人圈选的，多了没法读） */
const MAX_CANDIDATES = 5;
/** 候选查重视为"活跃"的状态（这些状态里同名 GP 存在则不再投） */
const ACTIVE_GP_STATUSES = ['candidate', 'proposed', 'converged', 'approved', 'in_dev'];

/** 是否在每周触发窗口内。 */
export function isInDirectionProposerWindow(now = new Date()) {
  return now.getUTCDay() === WINDOW_UTC_DAY
    && now.getUTCHours() === WINDOW_UTC_HOUR
    && now.getUTCMinutes() >= WINDOW_UTC_MINUTE_START
    && now.getUTCMinutes() < WINDOW_UTC_MINUTE_END;
}

/** 20h 去重（照 line-dreaming 先例）：哨兵即产物本身——无候选周也写全景，故可靠。 */
export async function alreadyProposedThisWeek(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM working_memory
     WHERE key = '${GAP_PANORAMA_KEY}'
       AND updated_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  return rows.length > 0;
}

/** 单段查询容错：失败返回空数组不阻断（照 line-dreaming safeRows）。 */
async function safeRows(queryPromise, label) {
  try {
    const { rows } = await queryPromise;
    return rows;
  } catch (err) {
    console.warn(`[direction-proposer] ${label} 查询失败（该段留空）:`, err.message);
    return [];
  }
}

/**
 * 跨线 KR 缺口扫描。复刻 ability-progress 端点对账语义，缺口 reason 四类
 * （优先级 missing_refs > thin_ability > advancement_incomplete；未登记单列）。
 * @returns {Promise<Array<{kr_id: string, kr_title: string, reason: string}>>}
 */
export async function collectKrGaps(pool) {
  const krs = await safeRows(
    pool.query(
      `SELECT id, title, metadata FROM key_results
       WHERE status IN ('active', 'in_progress', 'decomposing')
       ORDER BY created_at`
    ),
    'key_results'
  );

  const gaps = [];
  for (const kr of krs) {
    const targetIds = Array.isArray(kr.metadata?.target_abilities) ? kr.metadata.target_abilities : [];
    if (targetIds.length === 0) {
      gaps.push({ kr_id: kr.id, kr_title: kr.title, reason: 'no_target_abilities' });
      continue;
    }
    const validIds = targetIds.filter((tid) => UUID_RE.test(tid));
    const invalidCount = targetIds.length - validIds.length;

    let rows = [];
    if (validIds.length > 0) {
      rows = await safeRows(
        pool.query(
          `SELECT jf.id, jf.thickness,
                  COUNT(ai.id) FILTER (WHERE ai.status IN ('todo', 'doing')) AS open
           FROM journey_features jf
           LEFT JOIN advancement_items ai ON ai.ability_id = jf.id
           WHERE jf.id = ANY($1) AND jf.kind = 'ability'
           GROUP BY jf.id, jf.thickness`,
          [validIds]
        ),
        `kr ${kr.id} abilities`
      );
    }

    const foundIds = new Set(rows.map((r) => r.id));
    const missingCount = invalidCount + validIds.filter((tid) => !foundIds.has(tid)).length;
    let reason = null;
    if (missingCount > 0) reason = 'missing_refs';
    else if (rows.some((r) => r.thickness === 'thin')) reason = 'thin_ability';
    else if (rows.some((r) => Number(r.open) > 0)) reason = 'advancement_incomplete';

    if (reason) gaps.push({ kr_id: kr.id, kr_title: kr.title, reason });
  }
  return gaps;
}

/**
 * 推进项耗尽信号：active line 下所有 ability 无 todo/doing 推进项（含零条）。
 * 只进 LLM 上下文，不进 panorama gaps（gaps 格式钉死为 KR 维度）。
 */
export async function collectExhaustedLines(pool) {
  const rows = await safeRows(
    pool.query(
      `SELECT j.id, j.name FROM journeys j
       WHERE j.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM journey_features jf
           JOIN advancement_items ai ON ai.ability_id = jf.id
           WHERE jf.journey_id = j.id AND jf.kind = 'ability'
             AND ai.status IN ('todo', 'doing')
         )
       ORDER BY j.name`
    ),
    'exhausted_lines'
  );
  return rows.map((r) => ({ journey_id: r.id, journey_name: r.name }));
}

/** 直投池：Alex 直投 / capture 分诊来的既有 candidate（一等公民，已在菜单）。 */
export async function getDirectCandidates(pool) {
  return safeRows(
    pool.query(
      `SELECT id, title, one_liner, kr_id, journey_id FROM golden_paths
       WHERE status = 'candidate' AND source IN ('alex_direct', 'capture_triage')
       ORDER BY created_at DESC`
    ),
    'direct_candidates'
  );
}

function buildPrompt({ gaps, exhausted, direct }) {
  const gapLines = gaps.map((g) => `- KR「${g.kr_title}」(kr_id=${g.kr_id}) 缺口类型: ${g.reason}`);
  const exhaustedLines = exhausted.map((e) => `- ${e.journey_name} (journey_id=${e.journey_id})`);
  const directLines = direct.map((d) => `- ${d.title}: ${d.one_liner}`);
  return `你是 Cecelia 的每周方向策士。基于以下 OKR 缺口与推进项耗尽信号，提出最多 ${MAX_CANDIDATES} 条新 Golden Path 候选（方向菜单，供主理人圈选）。只输出 JSON。

## OKR 缺口（reason 含义：no_target_abilities=KR未挂能力 / missing_refs=挂的能力失联 / thin_ability=能力还是骨架 / advancement_incomplete=推进项未完）
${gapLines.length ? gapLines.join('\n') : '（无）'}

## 推进项耗尽的线（没有待推进项，需要新方向）
${exhaustedLines.length ? exhaustedLines.join('\n') : '（无）'}

## 已在菜单的直投候选（不要重复提相似方向）
${directLines.length ? directLines.join('\n') : '（无）'}

要求：
- 每条候选对准一个缺口或耗尽线；kr_id/journey_id 用上面给出的原值，没有对应就写 null
- one_liner 一句人话说清"做什么、为什么值得做"
- est_scale 用人话估规模（如"约2周产能/3个PR"）
- 输出格式：{"candidates":[{"title":"...","one_liner":"...","kr_id":"...或null","journey_id":"...或null","est_scale":"..."}]}`;
}

/**
 * 一次 LLM 汇总。失败/不可解析 → 降级空候选（llmFailed:true），确定性全景不受影响。
 * 无缺口且无耗尽线 → 不调 LLM。
 * @param {Function} llm callLLM 签名（可注入 mock）
 */
export async function proposeCandidates(llm, { gaps, exhausted, direct }) {
  if (gaps.length === 0 && exhausted.length === 0) {
    return { candidates: [], llmFailed: false };
  }
  try {
    const { text } = await llm('thalamus', buildPrompt({ gaps, exhausted, direct }), { maxTokens: 2048 });
    const parsed = extractJsonObject(text);
    if (!parsed || !Array.isArray(parsed.candidates)) {
      return { candidates: [], llmFailed: true };
    }
    const candidates = parsed.candidates
      .filter((c) => c && typeof c.title === 'string' && typeof c.one_liner === 'string')
      .slice(0, MAX_CANDIDATES)
      .map((c) => ({
        title: c.title,
        one_liner: c.one_liner,
        kr_id: c.kr_id ?? null,
        journey_id: c.journey_id ?? null,
        est_scale: c.est_scale ?? null,
      }));
    return { candidates, llmFailed: false };
  } catch (err) {
    console.warn('[direction-proposer] LLM 汇总失败（降级只写全景）:', err.message);
    return { candidates: [], llmFailed: true };
  }
}

/**
 * 候选写库：同 title 已存在活跃态 → skip 防重复；非法 UUID 引用置 null；单条失败不阻断。
 * @returns {Promise<{inserted: Array<{id: string, kr_id: string|null}>, skippedDuplicates: number, failed: number}>}
 */
export async function insertCandidates(pool, candidates) {
  const inserted = [];
  let skippedDuplicates = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM golden_paths WHERE title = $1 AND status = ANY($2) LIMIT 1`,
        [c.title, ACTIVE_GP_STATUSES]
      );
      if (dup.length > 0) {
        skippedDuplicates++;
        continue;
      }
      const krId = c.kr_id && UUID_RE.test(c.kr_id) ? c.kr_id : null;
      const journeyId = c.journey_id && UUID_RE.test(c.journey_id) ? c.journey_id : null;
      const { rows } = await pool.query(
        `INSERT INTO golden_paths (title, one_liner, journey_id, kr_id, est_scale, source)
         VALUES ($1, $2, $3, $4, $5, 'strategist')
         RETURNING id`,
        [c.title, c.one_liner, journeyId, krId, c.est_scale]
      );
      inserted.push({ id: rows[0].id, kr_id: krId });
    } catch (err) {
      console.warn(`[direction-proposer] 候选「${c.title}」写入失败（跳过）:`, err.message);
      failed++;
    }
  }
  return { inserted, skippedDuplicates, failed };
}

/**
 * OKR 缺口全景写 working_memory（并行约定钉死：GP6 晨报从 GAP_PANORAMA_KEY 读）。
 * gaps 只留无候选覆盖的（覆盖 = coveredKrIds 命中）。
 */
export async function writeGapPanorama(pool, gaps, coveredKrIds) {
  const uncovered = gaps.filter((g) => !coveredKrIds.has(g.kr_id));
  const value = { generated_at: new Date().toISOString(), gaps: uncovered };
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [GAP_PANORAMA_KEY, JSON.stringify(value)]
  );
  return uncovered.length;
}

/**
 * 主入口（scheduler-jobs handler）：窗口 gate → 20h 去重 → 三源聚合 → 一次 LLM → 写候选 → 写全景。
 * @param {import('pg').Pool} pool
 * @param {{now?: Date, llm?: Function}} [opts] 测试注入
 */
export async function maybeRunDirectionProposer(pool, { now = new Date(), llm = callLLM } = {}) {
  if (!isInDirectionProposerWindow(now)) {
    return { triggered: false };
  }
  if (await alreadyProposedThisWeek(pool)) {
    return { triggered: true, skipped: true };
  }

  const [gaps, exhausted, direct] = await Promise.all([
    collectKrGaps(pool),
    collectExhaustedLines(pool),
    getDirectCandidates(pool),
  ]);

  const { candidates, llmFailed } = await proposeCandidates(llm, { gaps, exhausted, direct });
  const { inserted, skippedDuplicates, failed } = await insertCandidates(pool, candidates);

  // 覆盖 = 本次新候选 + 直投池既有 candidate 的 kr_id 命中
  const coveredKrIds = new Set(
    [...inserted.map((i) => i.kr_id), ...direct.map((d) => d.kr_id)].filter(Boolean)
  );
  const gapsUncovered = await writeGapPanorama(pool, gaps, coveredKrIds);

  return {
    triggered: true,
    proposed: inserted.length,
    skippedDuplicates,
    failed,
    gapsTotal: gaps.length,
    gapsUncovered,
    exhaustedLines: exhausted.length,
    llmFailed,
  };
}
```

- [ ] **Step 2: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/direction-proposer.test.js`
Expected: PASS（全部用例）

- [ ] **Step 3: Commit（Green）**

```bash
git add packages/brain/src/direction-proposer.js
git commit -m "feat(brain): GP4/T4 direction-proposer 每周方向菜单——三源聚合+一次LLM汇总+缺口全景"
```

---

### Task 4: scheduler-jobs 登记 + JOBS 断言更新

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`（import + JOBS 加一行）
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`（13→14 个 job 断言）

- [ ] **Step 1: 更新 scheduler-jobs.test.js 断言（先 Red）**

`it('JOBS 注册了 13 个 job')` 改为 14 个，names 数组尾部加 `'direction-proposer'`（放 `launchd-patrol` 之后）。

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: FAIL（数量不符）

- [ ] **Step 2: scheduler-jobs.js 登记**

```js
import { maybeRunDirectionProposer } from './direction-proposer.js';
// JOBS 数组尾部：
  { name: 'direction-proposer', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunDirectionProposer, description: '每周方向菜单（自带北京周一05:30窗口+20h去重，候选写golden_paths+缺口全景写working_memory，GP4/T4）' },
```

- [ ] **Step 3: 跑 scheduler-jobs + direction-proposer 测试全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/direction-proposer.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "feat(brain): GP4/T4 direction-proposer 接入 scheduler-jobs（第14个job）"
```

---

### Task 5: smoke 脚本 + allowlist 登记（DoD F11 验证法）

**Files:**
- Create: `packages/brain/scripts/smoke/direction-proposer-t4-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`（按字母序插入一行）

- [ ] **Step 1: 写 smoke 脚本（照 golden-paths-t1-smoke.sh 骨架）**

```bash
#!/usr/bin/env bash
# direction-proposer-t4-smoke.sh
# GP4/T4 smoke：强制窗口内跑一次主入口（注入假 LLM），验证 golden_paths 出 candidate + working_memory 出 gp_gap_panorama（DoD F11）
set -uo pipefail

DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP: DB 不可达"; exit 0
fi

# 强制窗口时刻（2026-07-12 是周日，UTC 21:31）+ 注入假 LLM，直接调主入口
cd "$(dirname "$0")/../.." || exit 1
OUT=$(DATABASE_URL="$DB" node --input-type=module -e "
import pg from 'pg';
import { maybeRunDirectionProposer, GAP_PANORAMA_KEY } from './src/direction-proposer.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fakeLlm = async () => ({ text: JSON.stringify({ candidates: [{ title: 'smoke GP T4', one_liner: 'smoke 用例', kr_id: null, journey_id: null, est_scale: '烟测' }] }) });
const r = await maybeRunDirectionProposer(pool, { now: new Date(Date.UTC(2026, 6, 12, 21, 31)), llm: fakeLlm });
console.log(JSON.stringify(r));
await pool.end();
" 2>&1)
echo "[smoke] 主入口返回: $OUT"

echo "$OUT" | grep -q '"triggered":true' && ok "主入口窗口内触发" || fail "主入口未触发: $OUT"

# 去重哨兵存在（skipped 或首跑都会留下/依赖 panorama）
psql "$DB" -tAc "SELECT 1 FROM working_memory WHERE key='gp_gap_panorama'" | grep -q 1 \
  && ok "working_memory 有 gp_gap_panorama 全景" || fail "缺 gp_gap_panorama"

# 首跑会写 candidate；20h 内重跑 skipped 也算通过（幂等即设计）
if echo "$OUT" | grep -q '"skipped":true'; then
  ok "20h 去重生效（重跑 skip）"
else
  psql "$DB" -tAc "SELECT 1 FROM golden_paths WHERE title='smoke GP T4' AND source='strategist'" | grep -q 1 \
    && ok "golden_paths 出 strategist candidate" || fail "candidate 未写入"
  # 清理烟测数据
  psql "$DB" -tAc "DELETE FROM golden_paths WHERE title='smoke GP T4'" >/dev/null 2>&1
fi

echo "── smoke 结果: PASS=$PASS FAIL=$FAIL ──"
[[ $FAIL -eq 0 ]] || exit 1
```

- [ ] **Step 2: chmod + 本地跑一遍（真库）确认通过**

Run: `chmod +x packages/brain/scripts/smoke/direction-proposer-t4-smoke.sh && bash packages/brain/scripts/smoke/direction-proposer-t4-smoke.sh`
Expected: PASS 行 ≥2，exit 0

- [ ] **Step 3: allowlist 登记（按字母序）**

`packages/quality/smoke-allowlist.txt` 插入 `direction-proposer-t4-smoke.sh`。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/scripts/smoke/direction-proposer-t4-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "test(brain): GP4/T4 smoke 全链脚本+allowlist 登记——强制窗口+假LLM验证 DoD F11"
```

---

### Task 6: version bump + DevGate + learnings

**Files:**
- Modify: `packages/brain/package.json` 1.255.0 → 1.256.0（minor，feat）
- Modify: `packages/brain/package-lock.json` / `.brain-versions` / `DEFINITION.md`（四处同步）
- Create: `docs/learnings/cp-07121312-gp4-direction-proposer.md`

- [ ] **Step 1: bump 四处版本**

`packages/brain/package.json` version 改 1.256.0；`cd packages/brain && npm install --package-lock-only` 刷 lock；`.brain-versions` 追加一行 `1.256.0`；`DEFINITION.md` 版本行同步（schema_version 不变，本次无 migration）。

- [ ] **Step 2: DevGate 三件套**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过

- [ ] **Step 3: 写 learnings（含 ### 根本原因 / ### 下次预防 / - [ ]）**

```markdown
# GP4/T4 direction-proposer——scheduler job 内联取代新 task_type 的取舍

### 根本原因
「每周菜单」类周期产出容易被惯性建成新 task_type（task-router 四处登记+executor 分支+并发线），
但其本质是确定性聚合+一次 LLM 汇总，无需完整 dev 会话；接线面大而收益为零。

### 下次预防
- [ ] 周期性产出先问"需要完整 dev 会话吗"：不需要 → scheduler job 内联（ci_patrol/line-dreaming 先例），需要 → 才走 task_type
- [ ] 与并行消费方的数据约定（working_memory key/value 结构）必须在任务描述里钉死后再动工，防两端各写各的
```

- [ ] **Step 4: 全量相关测试最后过一遍**

Run: `cd packages/brain && npx vitest run src/__tests__/direction-proposer.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/json-utils.test.js src/__tests__/capture-triage.test.js src/__tests__/invariant-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md docs/learnings/cp-07121312-gp4-direction-proposer.md
git commit -m "chore(brain): version bump 1.256.0（GP4/T4 direction-proposer）+ learnings"
```

---

## DoD（push 前全部勾 [x]）

- [x] [BEHAVIOR] 每周窗口聚合三源产出候选与全景 — Test: `tests/ packages/brain/src/__tests__/direction-proposer.test.js`
- [x] [BEHAVIOR] scheduler-jobs 第 14 个 job 登记生效 — Test: `tests/ packages/brain/src/__tests__/scheduler-jobs.test.js`
- [x] [BEHAVIOR] DoD F11 真库验证 — Test: `manual: bash packages/brain/scripts/smoke/direction-proposer-t4-smoke.sh`
- [x] CI 全绿
