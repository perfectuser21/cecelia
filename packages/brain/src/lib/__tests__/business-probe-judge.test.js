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
        if (/UPDATE journey_step_links/.test(sql)) return { rows: [{ id: params[1] }] };
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
    const persist = vi.fn().mockResolvedValue({ id: 'rcpt' });
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
    expect(probeQuery.sql).toMatch(/JOIN journey_step_links/);
    expect(probeQuery.params).toEqual(['j-1', 'preflight']);
    const updates = calls.filter((c) => /UPDATE journey_step_links/.test(c.sql));
    expect(updates.map((u) => u.params)).toEqual([['green', LINK_A], ['red', LINK_B]]);
    updates.forEach((u) => expect(u.sql).toMatch(/SET cell_status = \$1/));
  });

  it('只判 active=true 的探针：YAML 删探针后库行 active=false（棒2 漂移语义），停用探针不得再以 probe_missing 把格子打红', async () => {
    const { pool, calls } = poolWith({ probes: [spec('p.ok', { op: '>=', value: 1 })] });
    await handleRunFinished(
      { runId: 'run-1', taskId: 't-1', status: 'success', result: result({ 'p.ok': { observed: 2 } }) },
      { pool, persist: vi.fn().mockResolvedValue({ id: 'rcpt' }) },
    );
    const probeQuery = calls.find((c) => /FROM step_probes/.test(c.sql));
    expect(probeQuery.sql).toMatch(/sp\.active = true/);
  });

  it('result 无 stage / task 无 anchor.journey_id / 无匹配 step_probes → 跳过，不写不翻色', async () => {
    const persist = vi.fn();
    const noStage = poolWith();
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: {} }, { pool: noStage.pool, persist })).toEqual({ skipped: 'no_stage' });
    expect(noStage.pool.query).not.toHaveBeenCalled();

    const noAnchor = poolWith({ journeyId: null });
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: result([]) }, { pool: noAnchor.pool, persist })).toEqual({ skipped: 'no_anchor' });

    const noProbes = poolWith({ probes: [] });
    expect(await handleRunFinished({ runId: 'r', taskId: 't', result: result([]) }, { pool: noProbes.pool, persist })).toEqual({ skipped: 'no_probes' });
    expect(persist).not.toHaveBeenCalled();
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
