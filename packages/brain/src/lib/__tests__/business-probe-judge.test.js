/**
 * [BEHAVIOR] business-probe-judge：run.finished → 比对 step_probes 与 task_runs.result.probes
 * → 写回执 → cell 翻色（棒3a 判定，任务 33aa2bc4，决策 702949b6 / 95e29afd）。
 *
 * 纯逻辑（judgeProbes / cellStatusFor / normalizeProbes）不碰 DB；
 * handleRunFinished 注入 pool + persist mock（step_probes 迁移属棒2，pg 集成测试待其合入后补）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  judgeProbes,
  cellStatusFor,
  normalizeProbes,
  aggregateCellStatus,
  handleRunFinished,
  registerBusinessProbeJudge,
} from '../business-probe-judge.js';

const LINK_A = '11111111-1111-4111-8111-111111111111';
const LINK_B = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

function spec(key, expect_, overrides = {}) {
  return {
    probe_key: key,
    stage: 'preflight',
    severity: 'error',
    spec_hash: HASH,
    journey_step_link_id: LINK_A,
    assertion_revision: 1,
    spec: { key, stage: 'preflight', journey_cell: 'stage:preflight', probe: { kind: 'sql' }, expect: expect_, severity: 'error' },
    ...overrides,
  };
}

function result(probes, metrics = {}, stage = 'preflight') {
  return { stage, stage_status: 'ok', metrics, evidence: {}, probes };
}

describe('normalizeProbes — 接受数组或对象两种形状', () => {
  it('数组 [{key,...}] → Map', () => {
    const m = normalizeProbes([{ key: 'a', observed: 1 }, { key: 'b', observed: null, error: 'x' }]);
    expect(m.get('a')).toEqual({ key: 'a', observed: 1 });
    expect(m.get('b').error).toBe('x');
  });
  it('对象 {key:{...}} → Map；非法输入 → 空 Map', () => {
    expect(normalizeProbes({ a: { observed: 2 } }).get('a')).toEqual({ key: 'a', observed: 2 });
    expect(normalizeProbes(null).size).toBe(0);
    expect(normalizeProbes('junk').size).toBe(0);
  });
});

describe('judgeProbes — 比对矩阵', () => {
  it('>= / == / <= 数值比对，expect.value', () => {
    const specs = [
      spec('ge', { op: '>=', value: 2 }),
      spec('eq', { op: '==', value: 'ok' }),
      spec('le', { op: '<=', value: 10 }),
    ];
    const out = judgeProbes(specs, result([
      { key: 'ge', observed: 3, probed_at: '2026-09-26T00:00:00.000Z' },
      { key: 'eq', observed: 'ok' },
      { key: 'le', observed: 11 },
    ]));
    expect(out.map((r) => [r.key, r.verdict, r.reason ?? null])).toEqual([
      ['ge', 'PASS', null], ['eq', 'PASS', null], ['le', 'FAIL', 'value_mismatch'],
    ]);
    expect(out[0]).toMatchObject({ observed: 3, expected: 2, op: '>=', severity: 'error', probed_at: '2026-09-26T00:00:00.000Z' });
  });

  it('expect.ref → 解析 metrics.<k>；找不到 → FAIL ref_unresolved', () => {
    const specs = [spec('n', { op: '==', ref: 'metrics.expected_count' }), spec('m', { op: '>=', ref: 'metrics.nope' })];
    const out = judgeProbes(specs, result({ n: { observed: 5 }, m: { observed: 1 } }, { expected_count: 5 }));
    expect(out[0]).toMatchObject({ verdict: 'PASS', expected: 5 });
    expect(out[1]).toMatchObject({ verdict: 'FAIL', reason: 'ref_unresolved', expected: null });
  });

  it('not_null_all：数组/对象全部非 null 才 PASS', () => {
    const specs = [spec('arr', { op: 'not_null_all' }), spec('obj', { op: 'not_null_all' }), spec('bad', { op: 'not_null_all' })];
    const out = judgeProbes(specs, result({
      arr: { observed: [1, 'x', 0] }, obj: { observed: { a: 1, b: 2 } }, bad: { observed: [1, null] },
    }));
    expect(out.map((r) => r.verdict)).toEqual(['PASS', 'PASS', 'FAIL']);
  });

  it('observed 缺失 → FAIL probe_missing；探针带 error → FAIL probe_error；op 非法 → FAIL op_unsupported', () => {
    const specs = [spec('miss', { op: '>=', value: 1 }), spec('err', { op: '>=', value: 1 }), spec('op', { op: '~', value: 1 })];
    const out = judgeProbes(specs, result({ err: { observed: 9, error: 'timeout' }, op: { observed: 1 } }));
    expect(out.map((r) => [r.verdict, r.reason])).toEqual([
      ['FAIL', 'probe_missing'], ['FAIL', 'probe_error'], ['FAIL', 'op_unsupported'],
    ]);
  });

  it('非数值参与 >= → FAIL value_mismatch；stage 不匹配的 spec 被跳过', () => {
    const specs = [spec('s', { op: '>=', value: 1 }), spec('other', { op: '>=', value: 1 }, { stage: 'delivery' })];
    const out = judgeProbes(specs, result({ s: { observed: 'abc' }, other: { observed: 5 } }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 's', verdict: 'FAIL', reason: 'value_mismatch' });
  });

  it('severity 取列值，缺列时回落 spec.severity，再缺回落 error', () => {
    const out = judgeProbes([
      spec('a', { op: '>=', value: 1 }, { severity: 'warn' }),
      spec('b', { op: '>=', value: 1 }, { severity: null, spec: { key: 'b', stage: 'preflight', expect: { op: '>=', value: 1 }, severity: 'warn' } }),
      spec('c', { op: '>=', value: 1 }, { severity: null, spec: { key: 'c', stage: 'preflight', expect: { op: '>=', value: 1 } } }),
    ], result({ a: { observed: 0 }, b: { observed: 0 }, c: { observed: 0 } }));
    expect(out.map((r) => r.severity)).toEqual(['warn', 'warn', 'error']);
  });
});

describe('cellStatusFor / aggregateCellStatus', () => {
  it('PASS→green；FAIL&error→red；FAIL&warn→pending', () => {
    expect(cellStatusFor('PASS', 'error')).toBe('green');
    expect(cellStatusFor('PASS', 'warn')).toBe('green');
    expect(cellStatusFor('FAIL', 'error')).toBe('red');
    expect(cellStatusFor('FAIL', 'warn')).toBe('pending');
  });
  it('同一 cell 多探针：red > pending > green', () => {
    expect(aggregateCellStatus(['green', 'pending', 'red'])).toBe('red');
    expect(aggregateCellStatus(['green', 'pending'])).toBe('pending');
    expect(aggregateCellStatus(['green', 'green'])).toBe('green');
  });
});

describe('handleRunFinished — DB 编排（pool/persist 注入）', () => {
  function poolWith({ journeyId = 'j-1', probes = [] } = {}) {
    const calls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM tasks/.test(sql)) return { rows: journeyId ? [{ journey_id: journeyId }] : [] };
        if (/FROM step_probes/.test(sql)) return { rows: probes };
        if (/UPDATE activity_cells/.test(sql)) return { rows: [{ id: params[1] }] };
        return { rows: [] };
      }),
    };
    return { pool, calls };
  }

  it('PASS → 写回执 + cell green；FAIL error → red；两探针同 cell 取最坏', async () => {
    const probes = [
      spec('p.ok', { op: '>=', value: 1 }),
      spec('p.bad', { op: '==', value: 'done' }, { journey_step_link_id: LINK_B, spec_hash: 'b'.repeat(64) }),
      spec('p.bad2', { op: '>=', value: 1 }, { journey_step_link_id: LINK_B, severity: 'warn' }),
    ];
    const { pool, calls } = poolWith({ probes });
    const persist = vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null });
    const out = await handleRunFinished(
      { runId: 'run-1', taskId: 't-1', status: 'success', result: result({ 'p.ok': { observed: 2 }, 'p.bad': { observed: 'nope' }, 'p.bad2': { observed: 0 } }) },
      { pool, persist },
    );
    expect(out).toMatchObject({ judged: 3, cells: { [LINK_A]: 'green', [LINK_B]: 'red' } });
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist.mock.calls[0][1]).toMatchObject({
      journeyStepLinkId: LINK_A, assertionRevision: 1, probeKey: 'p.ok', specHash: HASH, runId: 'run-1', verdict: 'PASS',
      evidence: { observed: 2, expected: 1, op: '>=', severity: 'error' },
    });
    expect(persist.mock.calls[1][1]).toMatchObject({ verdict: 'FAIL', evidence: { reason: 'value_mismatch' } });
    const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
    expect(probeQuery.sql).toMatch(/JOIN activity_cells/);
    expect(probeQuery.params).toEqual(['j-1', 'preflight']);
    const updates = calls.filter((c) => /UPDATE activity_cells/.test(c.sql));
    expect(updates.map((u) => u.params)).toEqual([['green', LINK_A], ['red', LINK_B]]);
    updates.forEach((u) => expect(u.sql).toMatch(/SET cell_status = \$1/));
  });

  it('只判 active=true 的探针：YAML 删探针后库行 active=false（棒2 漂移语义），停用探针不得再以 probe_missing 把格子打红', async () => {
    const { pool, calls } = poolWith({ probes: [spec('p.ok', { op: '>=', value: 1 })] });
    await handleRunFinished(
      { runId: 'run-1', taskId: 't-1', status: 'success', result: result({ 'p.ok': { observed: 2 } }) },
      { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) },
    );
    const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
    expect(probeQuery.sql).toMatch(/sp\.active = true/);
  });

  // 任务 4ca3b584（项目 4dd12ae1 第 3 棒）：账本 init 开跑时就为 scoring/qualification 写一个 blocked/not_in_profile 占位工件，
  // 阶段根本没跑，探针却照判——scoring 探针读到「本批评论 0 条待分拣」=PASS，格子 09-28 全天假绿。
  // blocked = 阶段没跑（not_in_profile / no_cards / lock_busy / push=0 skipped），没有结果可判，不得写回执、不得翻色。
  it('stage_status=blocked（阶段没跑）→ 不判、不写回执、不翻色，哪怕探针已登记且回执里没有探针读数', async () => {
    const probes = [spec('p.ok', { op: '>=', value: 1 })];
    const { pool, calls } = poolWith({ probes });
    const persist = vi.fn();
    const blocked = { ...result([], {}, 'preflight'), stage_status: 'blocked' };
    const out = await handleRunFinished({ runId: 'run-1', taskId: 't-1', status: 'in_progress', result: blocked }, { pool, persist });
    expect(out).toEqual({ skipped: 'stage_not_run' });
    expect(persist).not.toHaveBeenCalled();
    expect(calls.filter((c) => /UPDATE activity_cells/.test(c.sql))).toEqual([]);
  });

  it('stage_status=failed（阶段跑了但失败）仍要判——失败态的读回正是要暴露问题的', async () => {
    const probes = [spec('p.ok', { op: '>=', value: 1 })];
    const { pool } = poolWith({ probes });
    const persist = vi.fn().mockResolvedValue({ receipt: { id: 'r' }, persisted: true, skipped: null });
    const failed = { ...result({ 'p.ok': { observed: 0 } }, {}, 'preflight'), stage_status: 'failed' };
    const out = await handleRunFinished({ runId: 'run-1', taskId: 't-1', status: 'in_progress', result: failed }, { pool, persist });
    expect(out).toMatchObject({ judged: 1 });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('result 无 stage / task 无 anchor.journey_id / 无匹配 step_probes → 跳过，不写不翻色', async () => {
    const persist = vi.fn();
    const noStage = poolWith();
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: {} }, { pool: noStage.pool, persist })).toEqual({ skipped: 'no_stage' });
    expect(noStage.pool.query).not.toHaveBeenCalled();

    const noAnchor = poolWith({ journeyId: null });
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: result([]) }, { pool: noAnchor.pool, persist })).toEqual({ skipped: 'no_anchor_no_workflow' });

    const noProbes = poolWith({ probes: [] });
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: result([]) }, { pool: noProbes.pool, persist })).toEqual({ skipped: 'no_probes' });
    expect(persist).not.toHaveBeenCalled();
  });

  describe('无 anchor 兜底：按 run_id / result.workflow 解析 workflow 查 step_probes（任务 1be07583，09-27 获客链首跑 skipped no_anchor）', () => {
    const RUN_ID = 'social-keyword-leadgen-crontab-auto09270600__a1.delivery';
    const JOURNEY = 'j-leadgen';
    function deliveryProbes() {
      return [
        spec('delivery.sent', { op: '>=', value: 1 }, { stage: 'delivery', journey_id: JOURNEY }),
        spec('delivery.failed', { op: '<=', value: 0 }, { stage: 'delivery', journey_id: JOURNEY }),
        spec('delivery.ids', { op: 'not_null_all' }, { stage: 'delivery', journey_id: JOURNEY, journey_step_link_id: LINK_B }),
      ];
    }
    const observed = () => result(
      { 'delivery.sent': { observed: 3 }, 'delivery.failed': { observed: 0 }, 'delivery.ids': { observed: ['a', 'b'] } },
      {}, 'delivery',
    );

    it('task 无 anchor + run_id 形如 <workflow>-crontab-<TAG>__aN.<stage> → 按 workflow+stage 判定、写回执、翻 cell', async () => {
      const { pool, calls } = poolWith({ journeyId: null, probes: deliveryProbes() });
      const persist = vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null });
      const out = await handleRunFinished({ runId: RUN_ID, taskId: 't-mirror', status: 'success', result: observed() }, { pool, persist });
      expect(out).toMatchObject({ judged: 3, workflow: 'social-keyword-leadgen', cells: { [LINK_A]: 'green', [LINK_B]: 'green' } });
      expect(persist).toHaveBeenCalledTimes(3);
      const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
      expect(probeQuery.sql).toMatch(/sp\.workflow = \$1/);
      expect(probeQuery.sql).toMatch(/sp\.active = true/);
      expect(probeQuery.sql).toMatch(/JOIN activity_cells/);
      expect(probeQuery.params).toEqual(['social-keyword-leadgen', 'delivery']);
    });

    it('result.workflow 优先于 run_id 解析', async () => {
      const { pool, calls } = poolWith({ journeyId: null, probes: deliveryProbes() });
      await handleRunFinished(
        { runId: RUN_ID, taskId: 't-mirror', result: { ...observed(), workflow: 'explicit-wf' } },
        { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) },
      );
      expect(calls.find((c) => /FROM step_probes/.test(c.sql)).params).toEqual(['explicit-wf', 'delivery']);
    });

    it('有 anchor 仍走 journey_id 原路径，不看 run_id', async () => {
      const { pool, calls } = poolWith({ journeyId: 'j-1', probes: deliveryProbes() });
      await handleRunFinished({ runId: RUN_ID, taskId: 't-1', result: observed() }, { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) });
      const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
      expect(probeQuery.sql).toMatch(/jsl\.journey_id = \$1/);
      expect(probeQuery.params).toEqual(['j-1', 'delivery']);
      expect(calls.some((c) => /UPDATE tasks/.test(c.sql))).toBe(false);
    });

    it('判定成功后把唯一 journey_id 回填进 task.payload.anchor（只在为空时写一次）', async () => {
      const { pool, calls } = poolWith({ journeyId: null, probes: deliveryProbes() });
      await handleRunFinished({ runId: RUN_ID, taskId: 't-mirror', result: observed() }, { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) });
      const backfill = calls.find((c) => /UPDATE tasks/.test(c.sql));
      expect(backfill).toBeDefined();
      expect(backfill.sql).toMatch(/payload->'anchor'->>'journey_id' IS NULL/);
      expect(backfill.params).toEqual([JOURNEY, 't-mirror']);
      const idx = calls.indexOf(backfill);
      expect(calls.slice(0, idx).some((c) => /UPDATE activity_cells/.test(c.sql))).toBe(true);
    });

    it('探针横跨多个 journey → 不回填锚（歧义），判定照常', async () => {
      const probes = deliveryProbes();
      probes[2].journey_id = 'j-other';
      const { pool, calls } = poolWith({ journeyId: null, probes });
      const out = await handleRunFinished({ runId: RUN_ID, taskId: 't-mirror', result: observed() }, { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) });
      expect(out.judged).toBe(3);
      expect(calls.some((c) => /UPDATE tasks/.test(c.sql))).toBe(false);
    });

    it('无锚时 task.payload.wf_id/capability/cap 优先于 run_id 前缀：对标 run 账本前缀写死 social-keyword-leadgen-crontab- 不得错归（任务 c2d73868）', async () => {
      const calls = [];
      const pool = {
        query: vi.fn(async (sql, params) => {
          calls.push({ sql, params });
          if (/FROM tasks/.test(sql)) return { rows: [{ journey_id: null, wf_id: 'benchmark-leadgen', capability: null, cap: null }] };
          if (/FROM step_probes/.test(sql)) return { rows: [] };
          return { rows: [] };
        }),
      };
      const out = await handleRunFinished({ runId: RUN_ID, taskId: 't-bench', result: observed() }, { pool, persist: vi.fn() });
      expect(out).toEqual({ skipped: 'no_probes' });
      const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
      expect(probeQuery.params).toEqual(['benchmark-leadgen', 'delivery']);
      const taskQuery = calls.find((c) => /FROM tasks/.test(c.sql));
      expect(taskQuery.sql).toMatch(/payload->>'wf_id'/);
    });

    it('run_id 不含 -crontab- 且 result 无 workflow → skipped no_anchor_no_workflow', async () => {
      const { pool } = poolWith({ journeyId: null, probes: deliveryProbes() });
      const persist = vi.fn();
      expect(await handleRunFinished({ runId: 'run-plain-1', taskId: 't-mirror', result: observed() }, { pool, persist }))
        .toEqual({ skipped: 'no_anchor_no_workflow' });
      expect(persist).not.toHaveBeenCalled();
    });
  });

  it('回执落库汇总：persisted=N skipped=M 进日志与返回值；有 skipped 必 console.warn 点名 probe_key+reason（09-27 生产 judged=3 只落 1 行的静默病）', async () => {
    const probes = [
      spec('p.ok', { op: '>=', value: 1 }),
      spec('p.dup', { op: '>=', value: 1 }, { spec_hash: 'b'.repeat(64) }),
      spec('p.err', { op: '>=', value: 1 }, { spec_hash: 'c'.repeat(64) }),
    ];
    const { pool } = poolWith({ probes });
    const persist = vi.fn()
      .mockResolvedValueOnce({ receipt: { id: 'rcpt-1' }, persisted: true, skipped: null })
      .mockResolvedValueOnce({ receipt: null, persisted: false, skipped: { probe_key: 'p.dup', reason: 'duplicate' } })
      .mockResolvedValueOnce({ receipt: null, persisted: false, skipped: { probe_key: 'p.err', reason: 'db_error:23514:verdict_chk' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await handleRunFinished(
      { runId: 'run-1', taskId: 't-1', status: 'success', result: result({ 'p.ok': { observed: 2 }, 'p.dup': { observed: 2 }, 'p.err': { observed: 2 } }) },
      { pool, persist },
    );
    expect(out).toMatchObject({
      judged: 3,
      persisted: 1,
      skipped: [{ probe_key: 'p.dup', reason: 'duplicate' }, { probe_key: 'p.err', reason: 'db_error:23514:verdict_chk' }],
    });
    expect(out.receipts).toEqual([
      { key: 'p.ok', verdict: 'PASS', reason: null, receipt_id: 'rcpt-1', persisted: true, skipped_reason: null },
      { key: 'p.dup', verdict: 'PASS', reason: null, receipt_id: null, persisted: false, skipped_reason: 'duplicate' },
      { key: 'p.err', verdict: 'PASS', reason: null, receipt_id: null, persisted: false, skipped_reason: 'db_error:23514:verdict_chk' },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/\[business-probe-judge\] run=run-1 .*judged=3 persisted=1 skipped=2/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[business-probe-judge\] run=run-1 .*receipts skipped=2.*p\.dup=duplicate.*p\.err=db_error:23514:verdict_chk/));
    log.mockRestore();
    warn.mockRestore();
  });

  it('全部落库时不 warn，日志 persisted=N skipped=0', async () => {
    const { pool } = poolWith({ probes: [spec('p.ok', { op: '>=', value: 1 })] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await handleRunFinished(
      { runId: 'run-1', taskId: 't-1', status: 'success', result: result({ 'p.ok': { observed: 2 } }) },
      { pool, persist: vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null }) },
    );
    expect(out).toMatchObject({ judged: 1, persisted: 1, skipped: [] });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/judged=1 persisted=1 skipped=0/));
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it('pool 抛错 → fail-open 返回 {error}，不向上抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('pg down')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(handleRunFinished({ runId: 'r', taskId: 't', result: result([]) }, { pool, persist: vi.fn() }))
      .resolves.toEqual({ error: 'pg down' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[business-probe-judge]'));
    warn.mockRestore();
  });

  it('registerBusinessProbeJudge 订阅 run.finished 并把 payload 交给 handleRunFinished', async () => {
    const handlers = {};
    const on = vi.fn((type, fn) => { handlers[type] = fn; return () => { delete handlers[type]; }; });
    const handle = vi.fn().mockResolvedValue({ skipped: 'no_stage' });
    const unsub = registerBusinessProbeJudge({ pool: {}, on, handle });
    expect(on).toHaveBeenCalledWith('run.finished', expect.any(Function));
    await handlers['run.finished']({ runId: 'r' });
    expect(handle).toHaveBeenCalledWith({ runId: 'r' }, expect.objectContaining({ pool: {} }));
    unsub();
    expect(handlers['run.finished']).toBeUndefined();
  });
});

describe('handleRunFinished — step/enabler 级格子翻色 + 活动格向上汇总（任务 45e5db42，决策 3e867cad）', () => {
  const JOURNEY = 'j-1';
  const ACT_STEP = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const STEP_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const STEP_ID_2 = 'bbbbbbbb-0000-4000-8000-00000000000c';
  const ENABLER_ID = 'cccccccc-0000-4000-8000-00000000000c';
  const STEP_LINK = '33333333-3333-4333-8333-333333333333';
  const STEP_LINK_2 = '44444444-4444-4444-8444-444444444444';
  const ENABLER_LINK = '55555555-5555-4555-8555-555555555555';

  /**
   * mock pool 带一张内存 journey_step_links：UPDATE 会改内存行，
   * 子格解析查询（step_id_ref/enabler_id = ANY）与汇总查询（SELECT cell_status … step_id）都从内存行取。
   */
  function poolWithCells({ probes = [], cells = [] } = {}) {
    const rows = cells.map((c) => ({ ...c }));
    const calls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/UPDATE activity_cells/.test(sql)) {
          const row = rows.find((r) => r.id === params[1]);
          if (row) row.cell_status = params[0];
          return { rows: [{ id: params[1] }] };
        }
        if (/step_id_ref = ANY/.test(sql)) {
          const [journeys, stepIds, enablerIds] = params;
          return {
            rows: rows.filter((r) => journeys.includes(r.journey_id)
              && ['step', 'enabler'].includes(r.cell_level)
              && (stepIds.includes(r.step_id_ref) || enablerIds.includes(r.enabler_id))),
          };
        }
        if (/SELECT cell_status FROM activity_cells/.test(sql)) {
          const [journeyId, stepId] = params;
          return {
            rows: rows.filter((r) => r.journey_id === journeyId && r.step_id === stepId
              && ['step', 'enabler'].includes(r.cell_level)).map((r) => ({ cell_status: r.cell_status })),
          };
        }
        if (/FROM tasks/.test(sql)) return { rows: [{ journey_id: JOURNEY }] };
        if (/FROM step_probes/.test(sql)) return { rows: probes };
        return { rows: [] };
      }),
    };
    return { pool, calls, rows };
  }

  const activityCell = { id: LINK_A, journey_id: JOURNEY, step_id: ACT_STEP, cell_level: 'activity', step_id_ref: null, enabler_id: null, assertion_revision: 2, cell_status: 'gray' };
  const stepCell = { id: STEP_LINK, journey_id: JOURNEY, step_id: ACT_STEP, cell_level: 'step', step_id_ref: STEP_ID, enabler_id: null, assertion_revision: 1, cell_status: 'gray' };
  const stepCell2 = { id: STEP_LINK_2, journey_id: JOURNEY, step_id: ACT_STEP, cell_level: 'step', step_id_ref: STEP_ID_2, enabler_id: null, assertion_revision: 1, cell_status: 'gray' };
  const enablerCell = { id: ENABLER_LINK, journey_id: JOURNEY, step_id: ACT_STEP, cell_level: 'enabler', step_id_ref: null, enabler_id: ENABLER_ID, assertion_revision: 1, cell_status: 'gray' };

  const stepProbe = (key, expect_, overrides = {}) => spec(key, expect_, {
    stage: 'collection', journey_id: JOURNEY, target_type: 'step', target_id: STEP_ID, activity_step_id: ACT_STEP, assertion_revision: 2,
    spec: { key, stage: 'collection', probe: { kind: 'metric' }, expect: expect_, severity: 'error' },
    ...overrides,
  });
  const activityProbe = (key, expect_, overrides = {}) => spec(key, expect_, {
    stage: 'collection', journey_id: JOURNEY, target_type: 'activity', target_id: ACT_STEP, activity_step_id: ACT_STEP, assertion_revision: 2,
    spec: { key, stage: 'collection', probe: { kind: 'sql' }, expect: expect_, severity: 'error' },
    ...overrides,
  });
  const run = (probes) => ({ runId: 'run-s', taskId: 't-1', status: 'success', result: result(probes, {}, 'collection') });
  const okPersist = () => vi.fn().mockResolvedValue({ receipt: { id: 'rcpt' }, persisted: true, skipped: null });

  it('① 探针 target_type=step 的回执落到 step 格（journeyStepLinkId/assertionRevision 都是 step 格的）并翻 step 格；FAIL → step 红、所属活动红', async () => {
    const { pool, calls, rows } = poolWithCells({
      probes: [stepProbe('coll_rescan_rate', { op: '<=', value: 0.3 })],
      cells: [activityCell, stepCell, stepCell2],
    });
    const persist = okPersist();
    const out = await handleRunFinished(run({ coll_rescan_rate: { observed: 1 } }), { pool, persist });
    expect(out.cells).toEqual({ [STEP_LINK]: 'red', [LINK_A]: 'red' });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1]).toMatchObject({ journeyStepLinkId: STEP_LINK, assertionRevision: 1, probeKey: 'coll_rescan_rate', verdict: 'FAIL' });
    const updates = calls.filter((c) => /UPDATE activity_cells/.test(c.sql)).map((c) => c.params);
    expect(updates).toEqual([['red', STEP_LINK], ['red', LINK_A]]);
    expect(rows.find((r) => r.id === STEP_LINK_2).cell_status).toBe('gray');
  });

  it('① step PASS 且活动自身探针 PASS → step 绿、活动绿；活动格颜色 = 自身探针 ∪ 子格最坏值', async () => {
    const { pool } = poolWithCells({
      probes: [activityProbe('coll_count', { op: '>=', value: 1 }), stepProbe('coll_rescan_rate', { op: '<=', value: 0.3 })],
      cells: [activityCell, stepCell, stepCell2],
    });
    const persist = okPersist();
    const out = await handleRunFinished(run({ coll_count: { observed: 4 }, coll_rescan_rate: { observed: 0 } }), { pool, persist });
    expect(out.cells).toEqual({ [STEP_LINK]: 'green', [LINK_A]: 'green' });
    expect(persist.mock.calls[0][1]).toMatchObject({ journeyStepLinkId: LINK_A, assertionRevision: 2 });
    expect(persist.mock.calls[1][1]).toMatchObject({ journeyStepLinkId: STEP_LINK, assertionRevision: 1 });
  });

  it('② 活动自身探针 PASS 但 step 探针 FAIL(warn) → step pending；子格上一轮留下的红也拖红活动（red>pending>green>gray）', async () => {
    const { pool } = poolWithCells({
      probes: [activityProbe('coll_count', { op: '>=', value: 1 }), stepProbe('coll_rescan_rate', { op: '<=', value: 0.3 }, { severity: 'warn' })],
      cells: [activityCell, stepCell, { ...stepCell2, cell_status: 'red' }],
    });
    const out = await handleRunFinished(run({ coll_count: { observed: 4 }, coll_rescan_rate: { observed: 1 } }), { pool, persist: okPersist() });
    expect(out.cells).toEqual({ [STEP_LINK]: 'pending', [LINK_A]: 'red' });
  });

  it('① target_type=enabler → 翻 enabler 格（enabler_id 匹配），活动跟着汇总', async () => {
    const { pool } = poolWithCells({
      probes: [stepProbe('lock_ok', { op: '==', value: 1 }, { target_type: 'enabler', target_id: ENABLER_ID })],
      cells: [activityCell, enablerCell],
    });
    const persist = okPersist();
    const out = await handleRunFinished(run({ lock_ok: { observed: 1 } }), { pool, persist });
    expect(out.cells).toEqual({ [ENABLER_LINK]: 'green', [LINK_A]: 'green' });
    expect(persist.mock.calls[0][1]).toMatchObject({ journeyStepLinkId: ENABLER_LINK, assertionRevision: 1 });
  });

  it('target_type=step 但 journey 下没有对应 step 格 → 退回活动格（回执与翻色都落活动格），不丢判定', async () => {
    const { pool } = poolWithCells({
      probes: [stepProbe('coll_rescan_rate', { op: '<=', value: 0.3 })],
      cells: [activityCell],
    });
    const persist = okPersist();
    const out = await handleRunFinished(run({ coll_rescan_rate: { observed: 1 } }), { pool, persist });
    expect(out.cells).toEqual({ [LINK_A]: 'red' });
    expect(persist.mock.calls[0][1]).toMatchObject({ journeyStepLinkId: LINK_A, assertionRevision: 2 });
  });

  it('只有活动级探针（target_type=activity / 老行无 target）→ 不发子格解析查询，行为与从前一致', async () => {
    const { pool, calls } = poolWithCells({
      probes: [activityProbe('coll_count', { op: '>=', value: 1 }), spec('legacy', { op: '>=', value: 1 }, { stage: 'collection', journey_id: JOURNEY, activity_step_id: ACT_STEP })],
      cells: [activityCell],
    });
    const out = await handleRunFinished(run({ coll_count: { observed: 4 }, legacy: { observed: 1 } }), { pool, persist: okPersist() });
    expect(out.cells).toEqual({ [LINK_A]: 'green' });
    expect(calls.some((c) => /step_id_ref = ANY/.test(c.sql))).toBe(false);
  });
});
