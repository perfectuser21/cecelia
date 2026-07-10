/**
 * harness-line-context.test.js — A-1 Context Manifest 新模块单测（mock pool）。
 * 覆盖：三源 SQL 参数断言 / 去重 / 降级（单路失败仅 warn）/
 * 格式契约逐字断言（与 harness-planner v8.12.0 Step 0.4 例句同构 = E1 解析契约）/ 空→'' / 截断。
 * Spec: docs/superpowers/specs/2026-07-02-a1-context-manifest-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLineContext,
  formatLineContextForPrompt,
  fetchAndFormatLineContext,
  INVARIANT_SECTION_HEADER,
} from '../harness-line-context.js';

const TASK_ID = '11111111-2222-3333-4444-555555555555';
const ABILITY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JOURNEY_ID = 'ffffffff-0000-1111-2222-333333333333';

// 按 SQL 内容路由的 mock pool：step 查询 join golden_path，feature/area 查 decisions，
// FR 查 journey_features，taskRow 查 tasks 行（fetchAndFormatLineContext GAN 场景补齐用）
function makePool({ step = [], feature = [], area = [], fr = [], taskRow = null, fail = {} } = {}) {
  return {
    query: vi.fn(async (sql, params) => {
      if (/FROM tasks WHERE id=\$1/.test(sql)) {
        if (fail.taskRow) throw new Error('task row query down');
        return { rows: taskRow ? [taskRow] : [] };
      }
      if (/JOIN golden_path gp ON gp\.id = d\.target_id/.test(sql)) {
        if (fail.step) throw new Error('step query down');
        return { rows: step };
      }
      if (/target_type=\$1/.test(sql) || sql.includes("target_type='journey_feature'")) {
        if (fail.feature) throw new Error('feature query down');
        return { rows: feature };
      }
      if (/level=\$1/.test(sql) || sql.includes("level='area'")) {
        if (fail.area) throw new Error('area query down');
        return { rows: area };
      }
      if (/JOIN journey_features jf/.test(sql)) {
        if (fail.fr) throw new Error('fr query down');
        return { rows: fr };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

function findCall(pool, re) {
  return pool.query.mock.calls.find(([sql]) => re.test(sql));
}

let warnSpy;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('fetchLineContext — 三源 invariant SQL（与 routes/abilities.js 同源）', () => {
  it('三参齐全 → 发 4 路查询，step SQL 与 tasks/:id/golden-path-decisions 同源', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID });
    expect(pool.query).toHaveBeenCalledTimes(4);

    const stepCall = findCall(pool, /JOIN golden_path gp ON gp\.id = d\.target_id/);
    expect(stepCall).toBeTruthy();
    const [stepSql, stepParams] = stepCall;
    expect(stepSql).toMatch(/SELECT d\.\*, gp\.order_no/);
    expect(stepSql).toMatch(/d\.target_type='golden_path'/);
    expect(stepSql).toMatch(/gp\.owner_task_id=\$1/);
    expect(stepSql).toMatch(/d\.category=\$2/);
    // 审查修正：三源语义一致 — step 路也只取 active decision（与 feature/area 路一致）
    expect(stepSql).toMatch(/d\.status='active'/);
    expect(stepSql).toMatch(/ORDER BY gp\.order_no ASC, d\.created_at DESC/);
    expect(stepParams).toEqual([TASK_ID, 'invariant']);
  });

  it('journey_feature 路 SQL 与 GET /invariants 同源：category+status 固定，target 参数化', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { abilityId: ABILITY_ID });
    const call = findCall(pool, /target_type=\$1/);
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/SELECT \* FROM decisions WHERE category='invariant' AND status='active'/);
    expect(sql).toMatch(/target_id=\$2/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual(['journey_feature', ABILITY_ID]);
  });

  it('area 路 SQL 与 GET /invariants?level=area 同源', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, {});
    const call = findCall(pool, /level=\$1/);
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/SELECT \* FROM decisions WHERE category='invariant' AND status='active'/);
    expect(params).toEqual(['area']);
  });

  it('FR 路 SQL 与 journeys/:id/golden-paths 同源 + ability_status IN (done,working) 过滤', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { journeyId: JOURNEY_ID });
    const call = findCall(pool, /JOIN journey_features jf/);
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/SELECT jf\.id AS ability_id, jf\.name AS ability_name, jf\.status AS ability_status/);
    expect(sql).toMatch(/FROM golden_path gp/);
    expect(sql).toContain('JOIN journey_features jf ON gp.feature_id = jf.id');
    expect(sql).not.toContain('JOIN tasks t');
    expect(sql).toMatch(/jf\.journey_id = \$1/);
    expect(sql).toMatch(/jf\.status IN \('done','working'\)/);
    expect(sql).toMatch(/ORDER BY gp\.owner_task_id, gp\.order_no ASC/);
    expect(params).toEqual([JOURNEY_ID]);
  });

  it('参数缺省跳过对应路：全缺省只查 area，一次查询', async () => {
    const pool = makePool();
    const r = await fetchLineContext({ pool }, {});
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(findCall(pool, /level=\$1/)).toBeTruthy();
    expect(r).toEqual({ invariants: [], cumulativeFR: [] });
  });

  it('taskId 缺省 → 不发 step 查询；journeyId 缺省 → 不发 FR 查询', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { abilityId: ABILITY_ID });
    expect(findCall(pool, /JOIN golden_path gp/)).toBeUndefined();
    expect(findCall(pool, /JOIN journey_features jf/)).toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(2); // feature + area
  });

  it('三源合并附 source_level，并按 decision id 去重（step 优先于 journey_feature 优先于 area）', async () => {
    const d = (id, topic) => ({ id, topic, decision: `铁律${id}`, category: 'invariant' });
    const pool = makePool({
      step: [{ ...d('d1', '[L4]不进群'), order_no: 1 }],
      feature: [d('d1', '[L4]不进群'), d('d2', '[L4]防假成功')],
      area: [d('d2', '[L4]防假成功'), d('d3', '[全局]租户隔离')],
    });
    const { invariants } = await fetchLineContext(
      { pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID }
    );
    expect(invariants.map((x) => x.id)).toEqual(['d1', 'd2', 'd3']);
    expect(invariants[0].source_level).toBe('step');
    expect(invariants[1].source_level).toBe('journey_feature');
    expect(invariants[2].source_level).toBe('area');
  });

  it('累积 FR：按 owner_task_id 分组，steps 保序', async () => {
    const pool = makePool({
      fr: [
        { ability_id: 'a1', ability_name: '发视频', ability_status: 'done', owner_task_id: 't1', id: 'g1', order_no: 1, feature_id: 'f1', note: '打开页面' },
        { ability_id: 'a1', ability_name: '发视频', ability_status: 'done', owner_task_id: 't1', id: 'g2', order_no: 2, feature_id: 'f2', note: '点击发布' },
        { ability_id: 'a2', ability_name: '登录', ability_status: 'working', owner_task_id: 't2', id: 'g3', order_no: 1, feature_id: 'f3', note: '扫码' },
      ],
    });
    const { cumulativeFR } = await fetchLineContext({ pool }, { journeyId: JOURNEY_ID });
    expect(cumulativeFR).toHaveLength(2);
    expect(cumulativeFR[0]).toMatchObject({ ability_name: '发视频', owner_task_id: 't1' });
    expect(cumulativeFR[0].steps.map((s) => s.note)).toEqual(['打开页面', '点击发布']);
    expect(cumulativeFR[1]).toMatchObject({ ability_name: '登录', owner_task_id: 't2' });
  });

  it('单路失败 → 该路空数组 + console.warn（[line-context]…non-fatal），其余路不受影响，绝不 throw', async () => {
    const pool = makePool({
      area: [{ id: 'd9', topic: '[全局]租户隔离', decision: '按租户隔离' }],
      fr: [{ ability_id: 'a1', ability_name: '发视频', ability_status: 'done', owner_task_id: 't1', id: 'g1', order_no: 1, feature_id: null, note: 'x' }],
      fail: { feature: true },
    });
    const r = await fetchLineContext(
      { pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID }
    );
    expect(r.invariants.map((x) => x.id)).toEqual(['d9']);
    expect(r.cumulativeFR).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toContain('[line-context]');
    expect(warned).toContain('(non-fatal)');
  });

  it('全路失败 → { invariants: [], cumulativeFR: [] }，绝不 throw', async () => {
    const pool = makePool({ fail: { step: true, feature: true, area: true, fr: true } });
    const r = await fetchLineContext(
      { pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID }
    );
    expect(r).toEqual({ invariants: [], cumulativeFR: [] });
    expect(warnSpy).toHaveBeenCalledTimes(4);
  });
});

describe('fetchAndFormatLineContext — 三角色注入共用 helper（task→ids→fetch→format）', () => {
  it('task 自带 ability_id / payload.journey_id → 不查 tasks 行，直接返回格式化文本', async () => {
    const pool = makePool({ feature: [{ id: 'd1', topic: '[Line04]不进群', decision: '只私聊', category: 'invariant' }] });
    const text = await fetchAndFormatLineContext(
      { pool }, { id: TASK_ID, ability_id: ABILITY_ID, payload: { journey_id: JOURNEY_ID } }
    );
    expect(text).toContain(INVARIANT_SECTION_HEADER);
    expect(text).toContain('- [不进群] 只私聊（来源: journey_feature）');
    expect(findCall(pool, /FROM tasks WHERE id=\$1/)).toBeUndefined();
  });

  it('只有 task.id（GAN 图场景）→ 先查 tasks 行补齐 ability_id/journey_id 再 fetch', async () => {
    const pool = makePool({
      taskRow: { ability_id: ABILITY_ID, payload: { journey_id: JOURNEY_ID } },
      feature: [{ id: 'd1', topic: '[Line04]不进群', decision: '只私聊', category: 'invariant' }],
    });
    const text = await fetchAndFormatLineContext({ pool }, { id: TASK_ID });
    const rowCall = findCall(pool, /FROM tasks WHERE id=\$1/);
    expect(rowCall).toBeTruthy();
    expect(rowCall[1]).toEqual([TASK_ID]);
    expect(findCall(pool, /target_type=\$1/)[1]).toEqual(['journey_feature', ABILITY_ID]);
    expect(findCall(pool, /JOIN journey_features jf/)[1]).toEqual([JOURNEY_ID]);
    expect(text).toContain(INVARIANT_SECTION_HEADER);
  });

  it('全吞错：pool 缺 / task 无 id / 查询全炸 → 返回 "" 绝不 throw', async () => {
    expect(await fetchAndFormatLineContext({ pool: null }, { id: TASK_ID })).toBe('');
    expect(await fetchAndFormatLineContext({ pool: makePool() }, null)).toBe('');
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await fetchAndFormatLineContext({ pool }, { id: TASK_ID })).toBe('');
  });
});

describe('formatLineContextForPrompt — 与 planner Step 0.4 逐字同构（E1 契约）', () => {
  it('双空 → 空字符串（含 null/undefined 输入安全）', () => {
    expect(formatLineContextForPrompt({ invariants: [], cumulativeFR: [] })).toBe('');
    expect(formatLineContextForPrompt({})).toBe('');
    expect(formatLineContextForPrompt(null)).toBe('');
  });

  it('逐字契约：段头 + 行格式与 planner Step 0.4 例句同构', () => {
    const text = formatLineContextForPrompt({
      invariants: [
        { id: 'd1', topic: '[Line04]不进群', decision: '只私聊；群聊一律跳过', source_level: 'journey_feature' },
        { id: 'd2', topic: '[全局]租户隔离', decision: '记忆按租户×联系人隔离', source_level: 'area' },
      ],
      cumulativeFR: [
        { ability_name: '发抖音视频', steps: [{ order_no: 1, note: '打开页面' }, { order_no: 2, note: '点击发布' }] },
      ],
    });
    expect(text).toBe(
      '## Invariant 约束（铁律，本角色产出不得违反）\n'
      + '- [不进群] 只私聊；群聊一律跳过（来源: journey_feature）\n'
      + '- [租户隔离] 记忆按租户×联系人隔离（来源: area）\n'
      + '\n'
      + '## 累积 FR（本 line 已验收行为，不得回退/重复实现）\n'
      + '- 发抖音视频: Step1 打开页面 → Step2 点击发布'
    );
  });

  it('E1 解析契约：每条 invariant 行匹配 - \\[.+\\] .+（来源: .+）', () => {
    const text = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[Line04]不进群', decision: '只私聊', source_level: 'step' }],
      cumulativeFR: [],
    });
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- \[.+\] .+（来源: .+）$/);
  });

  it('标签：topic "]" 后为空时回落（去掉方括号后取前 6 字），不产出空标签', () => {
    const text = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[Line04]', decision: '只私聊', source_level: 'journey_feature' }],
      cumulativeFR: [],
    });
    expect(text).toContain('- [Line04] 只私聊（来源: journey_feature）');
    expect(text).not.toContain('- [] ');
  });

  it('标签：topic 无 "]" 时取前 6 字', () => {
    const text = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '防假成功必须确认气泡刷新', decision: '气泡未刷新不得判成功', source_level: 'area' }],
      cumulativeFR: [],
    });
    expect(text).toContain('- [防假成功必须] 气泡未刷新不得判成功（来源: area）');
  });

  it('单条铁律文字 >200 字截断', () => {
    const text = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[X]长文', decision: 'x'.repeat(300), source_level: 'area' }],
      cumulativeFR: [],
    });
    const line = text.split('\n').find((l) => l.startsWith('- '));
    expect(line).toContain('x'.repeat(200) + '…');
    expect(line).not.toContain('x'.repeat(201));
  });

  it('FR 单行 >120 字截断', () => {
    const text = formatLineContextForPrompt({
      invariants: [],
      cumulativeFR: [{ ability_name: '长', steps: [{ order_no: 1, note: 'y'.repeat(300) }] }],
    });
    const line = text.split('\n').find((l) => l.startsWith('- '));
    expect(line.length).toBeLessThanOrEqual(121); // 120 + '…'
    expect(line.endsWith('…')).toBe(true);
  });

  it('>20 个 ability 截断并加注', () => {
    const cumulativeFR = Array.from({ length: 25 }, (_, i) => ({
      ability_name: `能力${i}`, steps: [{ order_no: 1, note: 'x' }],
    }));
    const text = formatLineContextForPrompt({ invariants: [], cumulativeFR });
    const frLines = text.split('\n').filter((l) => l.startsWith('- ') && l.includes('能力'));
    expect(frLines).toHaveLength(20);
    expect(text).toContain('另有 5 个 ability 略');
  });

  it('空段省略：只有 invariants → 无累积 FR 段头；只有 FR → 无 Invariant 段头', () => {
    const onlyInv = formatLineContextForPrompt({
      invariants: [{ id: 'd1', topic: '[X]a', decision: 'b', source_level: 'area' }],
      cumulativeFR: [],
    });
    expect(onlyInv).toContain('## Invariant 约束');
    expect(onlyInv).not.toContain('## 累积 FR');

    const onlyFR = formatLineContextForPrompt({
      invariants: [],
      cumulativeFR: [{ ability_name: 'a', steps: [{ order_no: 1, note: 'b' }] }],
    });
    expect(onlyFR).toContain('## 累积 FR');
    expect(onlyFR).not.toContain('## Invariant 约束');
  });

  it('总长兜底 ≤4000 字截断', () => {
    const invariants = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`, topic: `[X]t${i}`, decision: 'z'.repeat(190), source_level: 'area',
    }));
    const text = formatLineContextForPrompt({ invariants, cumulativeFR: [] });
    expect(text.length).toBeLessThanOrEqual(4001); // 4000 + '…'
  });
});
