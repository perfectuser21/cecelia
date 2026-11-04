import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => {
  const deny = label => vi.fn(() => { throw Error(`unexpected external ${label}`); });
  return { dbQuery: deny('db query'), dbConnect: deny('db connect'), llm: deny('model'),
    createTask: deny('task creation'), process: deny('process'), fetch: deny('network') };
});
vi.mock('../db.js', () => ({ default: { query: boundary.dbQuery, connect: boundary.dbConnect } }));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.llm }));
vi.mock('../actions.js', () => ({ createTask: boundary.createTask }));
vi.mock('node:child_process', () => ({ spawn: boundary.process, spawnSync: boundary.process,
  exec: boundary.process, execSync: boundary.process, execFile: boundary.process, execFileSync: boundary.process }));
vi.mock('child_process', () => ({ spawn: boundary.process, spawnSync: boundary.process,
  exec: boundary.process, execSync: boundary.process, execFile: boundary.process, execFileSync: boundary.process }));

import { checkInvariantCandidate } from '../invariant-gate.js';
import { runCaptureTriage, __resetCaptureTriageForTest } from '../capture-triage.js';

const atom = { id: 'owned-invariant-atom', target_type: 'learning', content: '根本原因是缺少准入字段，规则必须完整验证' };
const valid = { conflict: false, verifiable: true, scope_ok: true, fr_contradiction: false };
const llmJson = result => vi.fn(async () => ({ text: JSON.stringify(result) }));
const malformed = [['missing'], ['null', null], ['string true', 'true'], ['string false', 'false'],
  ['zero', 0], ['one', 1], ['array', []], ['object', {}]];
const invalidCases = ['conflict', 'verifiable', 'scope_ok', 'fr_contradiction'].flatMap(field =>
  malformed.map(([label, value]) => {
    const result = { ...valid, [field]: value };
    if (label === 'missing') delete result[field];
    return { name: `${field}: ${label}`, result };
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', boundary.fetch);
  __resetCaptureTriageForTest();
});
afterEach(() => {
  for (const fn of Object.values(boundary)) expect(fn).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('四查只接受完整布尔，不把未知转成通过', () => {
  it.each(invalidCases)('$name 拒绝且不返回伪造 checks', async ({ result }) => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const gate = await checkInvariantCandidate(pool, atom, { llm: llmJson(result) });
    expect(gate).toEqual({ pass: false, checks: null, reason: 'invariant-gate parse_failed' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/^SELECT topic, decision FROM decisions/);
  });

  it('完整四查通过保持原合同', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await checkInvariantCandidate(pool, atom, { llm: llmJson({ ...valid, reason: '完整' }) }))
      .toEqual({ pass: true, checks: valid, reason: '完整' });
  });
});

function triageFixture({ allowDecision = false } = {}) {
  const parked = [];
  const client = { query: vi.fn(async (sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return {};
    if (/INSERT INTO decisions/.test(sql)) return { rows: [{ id: 'owned-decision' }] };
    if (/UPDATE capture_atoms/.test(sql)) return { rowCount: 1 };
    throw Error(`unexpected transaction SQL: ${sql}`);
  }), release: vi.fn() };
  const pool = { query: vi.fn(async (sql, params) => {
    if (/FROM capture_atoms/.test(sql)) return { rows: [atom] };
    if (/SELECT topic, decision FROM decisions/.test(sql)) return { rows: [] };
    if (/SELECT id FROM decisions/.test(sql)) return { rows: [] };
    if (/UPDATE capture_atoms/.test(sql)) { parked.push({ sql, params }); return { rowCount: 1 }; }
    throw Error(`unexpected pool SQL: ${sql}`);
  }), connect: vi.fn(async () => {
    if (!allowDecision) throw Error('invalid gate must not enter decision transaction');
    return client;
  }) };
  return { pool, client, parked };
}

describe('真实 capture-triage 消费四查结果', () => {
  it.each([
    ['missing', { conflict: false, verifiable: true, scope_ok: true }],
    ['null', { ...valid, fr_contradiction: null }],
    ['string', { ...valid, fr_contradiction: 'true' }],
  ])('第四查 %s 留箱 parked，不获得 decisions 写入资格', async (_name, response) => {
    const { pool, client, parked } = triageFixture();
    expect(await runCaptureTriage(pool, { llm: llmJson(response) })).toEqual({ processed: 1, failed: 0 });
    expect(parked).toHaveLength(1);
    expect(parked[0].sql).toContain("status = 'parked'");
    expect(parked[0].params).toEqual([atom.id, '[triage:gate_fail] invariant-gate parse_failed checks=null', 0.8]);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => /SELECT id FROM decisions/.test(sql))).toBe(false);
  });

  it('完整有效四查仍经真实分诊走原事务写入封套', async () => {
    const { pool, client, parked } = triageFixture({ allowDecision: true });
    expect(await runCaptureTriage(pool, { llm: llmJson(valid) })).toEqual({ processed: 1, failed: 0 });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toMatch(/INSERT INTO decisions/);
    expect(client.query.mock.calls[1][1].slice(0, 3)).toEqual(['invariant', `[capture-triage] ${atom.content}`, atom.content]);
    expect(statements[2]).toContain("status = 'confirmed'");
    expect(client.query.mock.calls[2][1]).toEqual([atom.id, '[triage:invariant] gate PASS. ', 'decisions', 'owned-decision', 0.8]);
    expect(statements[3]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(parked).toEqual([]);
  });
});
