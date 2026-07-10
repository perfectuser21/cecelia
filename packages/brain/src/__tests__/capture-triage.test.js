import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyCheapRules, runCaptureTriage, __resetCaptureTriageForTest } from '../capture-triage.js';

vi.mock('../invariant-gate.js', () => ({ checkInvariantCandidate: vi.fn() }));
import { checkInvariantCandidate } from '../invariant-gate.js';

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

function makePool(atoms, extra = {}) {
  const updates = [];
  const inserts = [];
  const pool = {
    updates, inserts,
    query: vi.fn(async (sql, params) => {
      if (/SELECT [\s\S]* FROM capture_atoms/.test(sql)) return { rows: atoms };
      if (/UPDATE capture_atoms/.test(sql)) { updates.push({ sql, params }); return { rowCount: 1 }; }
      if (/INSERT INTO decisions/.test(sql)) { inserts.push({ sql, params }); return { rows: [{ id: 'dec-1' }] }; }
      if (/SELECT payload->>'journey_id'/.test(sql)) return { rows: [{ journey_id: extra.journeyId !== undefined ? extra.journeyId : 'jrn-1' }] };
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
