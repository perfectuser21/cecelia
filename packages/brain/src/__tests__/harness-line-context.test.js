/**
 * harness-line-context.test.js — A-1 Context Manifest 新模块单测（mock pool）。
 * 覆盖：四层 SQL 参数断言 / 去重 / 降级（单路失败仅 warn）/
 * 格式契约逐字断言（与 harness-planner v8.12.0 Step 0.4 例句同构 = E1 解析契约）/ 空→'' / 截断。
 * Spec: docs/superpowers/specs/2026-07-02-a1-context-manifest-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLineContext,
  formatLineContextForPrompt,
  fetchAndFormatLineContext,
  INVARIANT_SECTION_HEADER,
  LINE_LEDGER_SECTION_HEADER,
} from '../harness-line-context.js';

const TASK_ID = '11111111-2222-3333-4444-555555555555';
const ABILITY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JOURNEY_ID = 'ffffffff-0000-1111-2222-333333333333';

// 按 SQL 内容路由的 mock pool：step 查询 join golden_path，feature/global+area 查 decisions，
// FR 查 journey_features，taskRow 查 tasks 行（fetchAndFormatLineContext GAN 场景补齐用）
function makePool({ step = [], feature = [], area = [], fr = [], taskRow = null, ledger = null, fail = {} } = {}) {
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
      if (/level IN \('global','area'\)/.test(sql)) {
        if (fail.area) throw new Error('area query down');
        return { rows: area };
      }
      if (/JOIN journey_features jf/.test(sql)) {
        if (fail.fr) throw new Error('fr query down');
        return { rows: fr };
      }
      if (/FROM design_docs/.test(sql)) {
        if (fail.ledger) throw new Error('ledger query down');
        return { rows: ledger ? [ledger] : [] };
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

describe('fetchLineContext — 四层 invariant SQL（与 routes/abilities.js 同源）', () => {
  it('三参齐全 → 发 5 路查询，step SQL 与 tasks/:id/golden-path-decisions 同源', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID });
    expect(pool.query).toHaveBeenCalledTimes(5);

    const stepCall = findCall(pool, /JOIN golden_path gp ON gp\.id = d\.target_id/);
    expect(stepCall).toBeTruthy();
    const [stepSql, stepParams] = stepCall;
    expect(stepSql).toMatch(/SELECT d\.\*, gp\.order_no/);
    expect(stepSql).toMatch(/d\.target_type='golden_path'/);
    expect(stepSql).toMatch(/gp\.owner_task_id=\$1/);
    expect(stepSql).toMatch(/d\.category=\$2/);
    // 审查修正：四层语义一致 — step 路也只取 active decision
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

  it('global + area 路一次读取两层，并保留真实 source_level', async () => {
    const pool = makePool({
      area: [
        { id: 'global-risk', topic: '[全局]高风险', decision: '命中即走人', level: 'global' },
        { id: 'area-rule', topic: '[业务区]租户隔离', decision: '按租户隔离', level: 'area' },
      ],
    });
    const result = await fetchLineContext({ pool }, {});
    const call = findCall(pool, /level IN \('global','area'\)/);
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/SELECT \* FROM decisions WHERE category='invariant' AND status='active'/);
    expect(sql).toMatch(/ORDER BY CASE level WHEN 'global' THEN 0 ELSE 1 END/);
    expect(params).toEqual([]);
    expect(result.invariants.find((d) => d.id === 'global-risk').source_level).toBe('global');
    expect(result.invariants.find((d) => d.id === 'area-rule').source_level).toBe('area');
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

  it('参数缺省跳过对应路：全缺省只查 global + area，一次查询', async () => {
    const pool = makePool();
    const r = await fetchLineContext({ pool }, {});
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(findCall(pool, /level IN \('global','area'\)/)).toBeTruthy();
    expect(r).toEqual({ invariants: [], cumulativeFR: [], ledger: null });
  });

  it('taskId 缺省 → 不发 step 查询；journeyId 缺省 → 不发 FR 查询', async () => {
    const pool = makePool();
    await fetchLineContext({ pool }, { abilityId: ABILITY_ID });
    expect(findCall(pool, /JOIN golden_path gp/)).toBeUndefined();
    expect(findCall(pool, /JOIN journey_features jf/)).toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(2); // feature + global/area
  });

  it('四层合并附 source_level，并按 decision id 去重（step > journey_feature > global > area）', async () => {
    const d = (id, topic) => ({ id, topic, decision: `铁律${id}`, category: 'invariant' });
    const pool = makePool({
      step: [{ ...d('d1', '[L4]不进群'), order_no: 1 }],
      feature: [d('d1', '[L4]不进群'), d('d2', '[L4]防假成功')],
      area: [
        { ...d('d2', '[L4]防假成功'), level: 'global' },
        { ...d('d3', '[全局]高风险清单'), level: 'global' },
        { ...d('d4', '[业务区]租户隔离'), level: 'area' },
      ],
    });
    const { invariants } = await fetchLineContext(
      { pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID }
    );
    expect(invariants.map((x) => x.id)).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(invariants[0].source_level).toBe('step');
    expect(invariants[1].source_level).toBe('journey_feature');
    expect(invariants[2].source_level).toBe('global');
    expect(invariants[3].source_level).toBe('area');
  });

  it('累积 FR：按 owner_task_id 分组，steps 保序', async () => {
    const pool = makePool({
      fr: [
        { ability_id: 'a1', ability_name: '发视频', ability_status: 'done', owner_task_id: 't1', id: 'g1', order_no: 1, feature_id: 'a1', note: '打开页面' },
        { ability_id: 'a1', ability_name: '发视频', ability_status: 'done', owner_task_id: 't1', id: 'g2', order_no: 2, feature_id: 'a1', note: '点击发布' },
        { ability_id: 'a2', ability_name: '登录', ability_status: 'working', owner_task_id: 't2', id: 'g3', order_no: 1, feature_id: 'a2', note: '扫码' },
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
      area: [{ id: 'd9', topic: '[全局]租户隔离', decision: '按租户隔离', level: 'global' }],
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

  it('全路失败 → { invariants: [], cumulativeFR: [], ledger: null }，绝不 throw', async () => {
    const pool = makePool({ fail: { step: true, feature: true, area: true, fr: true, ledger: true } });
    const r = await fetchLineContext(
      { pool }, { taskId: TASK_ID, abilityId: ABILITY_ID, journeyId: JOURNEY_ID }
    );
    expect(r).toEqual({ invariants: [], cumulativeFR: [], ledger: null });
    expect(warnSpy).toHaveBeenCalledTimes(5);
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
        { id: 'd2', topic: '[全局]高风险', decision: '命中高风险必须真人确认', source_level: 'global' },
        { id: 'd3', topic: '[业务区]租户隔离', decision: '记忆按租户×联系人隔离', source_level: 'area' },
      ],
      cumulativeFR: [
        { ability_name: '发抖音视频', steps: [{ order_no: 1, note: '打开页面' }, { order_no: 2, note: '点击发布' }] },
      ],
    });
    expect(text).toBe(
      '## Invariant 约束（铁律，本角色产出不得违反）\n'
      + '- [不进群] 只私聊；群聊一律跳过（来源: journey_feature）\n'
      + '- [高风险] 命中高风险必须真人确认（来源: global）\n'
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

  it('>50 个 ability 截断并加注', () => {
    const cumulativeFR = Array.from({ length: 55 }, (_, i) => ({
      ability_name: `能力${i}`, steps: [{ order_no: 1, note: 'x' }],
    }));
    const text = formatLineContextForPrompt({ invariants: [], cumulativeFR });
    const frLines = text.split('\n').filter((l) => l.startsWith('- ') && l.includes('能力'));
    expect(frLines).toHaveLength(50);
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

  it('总长兜底 ≤12000 字截断', () => {
    const invariants = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`, topic: `[X]t${i}`, decision: 'z'.repeat(190), source_level: 'area',
    }));
    const text = formatLineContextForPrompt({ invariants, cumulativeFR: [] });
    expect(text.length).toBeLessThanOrEqual(12001); // 12000 + '…'
    expect(text.length).toBeGreaterThan(4001); // 证明不是旧 4000 上限
  });
});

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
