// 冻结合同测试（TDD RED）— check-handoffs.mjs 契约 schema 化
// 位置词铁律：实现落在 packages/brain/src/orchestrator/check-handoffs.mjs
// 禁 mock 边：本测试直接 import 真实 home-sequencer.STAGE_ORDER 与真实 handoff-schemas，
//   check-handoffs 的 CODING_CELLS 必须从真实格序派生、artifact 判据必须复用真实 shape 校验器，
//   任何一处被 hardcode/mock 顶替都会被本测试抓到。
import { describe, it, expect } from 'vitest';
import { STAGE_ORDER } from '../../../packages/brain/src/orchestrator/home-sequencer.js';
import {
  CODING_CELLS,
  LEADGEN_CELLS,
  ASSERTION_CATEGORIES,
  CONTRACTS,
  evaluateAssertion,
  runCellContracts,
} from '../../../packages/brain/src/orchestrator/check-handoffs.mjs';

const VALID_CANDIDATE = {
  repo: 'perfectuser21/cecelia',
  branch: 'cp-harness-generate-r1-abc',
  head_sha: 'a'.repeat(40),
  bridge_run_id: '11111111-1111-4111-8111-111111111111',
  source_attempt_id: '22222222-2222-4222-8222-222222222222',
};

describe('check-handoffs CONTRACTS 契约 schema 化 [BEHAVIOR]', () => {
  it('CODING_CELLS 恰为 home-sequencer STAGE_ORDER 去掉 init/finalize 的九格', () => {
    const expected = STAGE_ORDER.filter((s) => !s.startsWith('__'));
    expect(expected).toHaveLength(9);
    expect(CODING_CELLS).toEqual(expected);
  });

  it('LEADGEN_CELLS 恰 8 格且与 CODING_CELLS 无交集', () => {
    expect(LEADGEN_CELLS).toHaveLength(8);
    const overlap = LEADGEN_CELLS.filter((c) => CODING_CELLS.includes(c));
    expect(overlap).toEqual([]);
  });

  it('ASSERTION_CATEGORIES 恰为六类且冻结不可变', () => {
    expect([...ASSERTION_CATEGORIES].sort()).toEqual(
      [
        'artifact_compliance',
        'externally_visible',
        'negative_boundary',
        'numeric_threshold',
        'record_persisted',
        'state_transition',
      ].sort(),
    );
    expect(Object.isFrozen(ASSERTION_CATEGORIES)).toBe(true);
  });

  it('CONTRACTS 覆盖全部 17 格且每格含 precondition/postcondition/side_effects 三段', () => {
    const all = [...CODING_CELLS, ...LEADGEN_CELLS];
    expect(Object.keys(CONTRACTS).sort()).toEqual([...all].sort());
    for (const cell of all) {
      const c = CONTRACTS[cell];
      expect(Array.isArray(c.precondition)).toBe(true);
      expect(Array.isArray(c.postcondition)).toBe(true);
      expect(Array.isArray(c.side_effects)).toBe(true);
      const assertions = [...c.precondition, ...c.postcondition, ...c.side_effects];
      // 非空：每格至少一条断言，且每条断言 category 属于六类、id 唯一
      expect(assertions.length).toBeGreaterThan(0);
      const ids = assertions.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const a of assertions) {
        expect(ASSERTION_CATEGORIES).toContain(a.category);
      }
    }
  });

  it('artifact_compliance 合规交接对象判 PASS', async () => {
    const r = await evaluateAssertion(
      { id: 't-art-ok', category: 'artifact_compliance', handoff_kind: 'candidate_coordinates', field: 'candidate' },
      { candidate: { ...VALID_CANDIDATE } },
      {},
    );
    expect(r.status).toBe('PASS');
  });

  it('artifact_compliance 缺 source_attempt_id 判 FAIL 并点名字段', async () => {
    const bad = { ...VALID_CANDIDATE };
    delete bad.source_attempt_id;
    const r = await evaluateAssertion(
      { id: 't-art-bad', category: 'artifact_compliance', handoff_kind: 'candidate_coordinates', field: 'candidate' },
      { candidate: bad },
      {},
    );
    expect(r.status).toBe('FAIL');
    expect(r.reason).toMatch(/source_attempt_id/);
  });

  it('state_transition 合法迁移判 PASS 非法迁移判 FAIL', async () => {
    const desc = {
      id: 't-state',
      category: 'state_transition',
      from_field: 'prev_status',
      to_field: 'next_status',
      allowed: [['in_progress', 'completed']],
    };
    const ok = await evaluateAssertion(desc, { prev_status: 'in_progress', next_status: 'completed' }, {});
    expect(ok.status).toBe('PASS');
    const bad = await evaluateAssertion(desc, { prev_status: 'in_progress', next_status: 'queued' }, {});
    expect(bad.status).toBe('FAIL');
  });

  it('numeric_threshold 达标判 PASS 未达标判 FAIL', async () => {
    const desc = { id: 't-num', category: 'numeric_threshold', field: 'score', min: 7 };
    expect((await evaluateAssertion(desc, { score: 8 }, {})).status).toBe('PASS');
    expect((await evaluateAssertion(desc, { score: 3 }, {})).status).toBe('FAIL');
  });

  it('negative_boundary 越界输入被真拦判 PASS 漏网判 FAIL', async () => {
    // tampered=缺字段的非法 candidate → shape 层必须拒 → 断言判 PASS（越界真被拦）
    const tampered = { ...VALID_CANDIDATE };
    delete tampered.head_sha;
    const caught = await evaluateAssertion(
      { id: 't-neg-ok', category: 'negative_boundary', handoff_kind: 'candidate_coordinates', tampered },
      {},
      {},
    );
    expect(caught.status).toBe('PASS');
    // tampered=完全合法对象 → shape 层不会拒 → 越界断言本身漏网 → 判 FAIL（防止假拦）
    const slipped = await evaluateAssertion(
      { id: 't-neg-bad', category: 'negative_boundary', handoff_kind: 'candidate_coordinates', tampered: { ...VALID_CANDIDATE } },
      {},
      {},
    );
    expect(slipped.status).toBe('FAIL');
  });

  it('record_persisted 无 db resolver 判 UNDECIDABLE 不判 PASS', async () => {
    const desc = { id: 't-rec', category: 'record_persisted', table: 'attempts', where: "run_id='x'", min_count: 1, within_seconds: 300 };
    const r = await evaluateAssertion(desc, {}, {});
    expect(r.status).toBe('UNDECIDABLE');
    expect(r.status).not.toBe('PASS');
  });

  it('record_persisted resolver 计数达标判 PASS 不足判 FAIL', async () => {
    const desc = { id: 't-rec2', category: 'record_persisted', table: 'attempts', where: "run_id='x'", min_count: 1, within_seconds: 300 };
    const passCtx = { resolvers: { dbCount: async () => 2 } };
    expect((await evaluateAssertion(desc, {}, passCtx)).status).toBe('PASS');
    const failCtx = { resolvers: { dbCount: async () => 0 } };
    expect((await evaluateAssertion(desc, {}, failCtx)).status).toBe('FAIL');
  });

  it('externally_visible 无 probe resolver 判 UNDECIDABLE 不判 PASS', async () => {
    const desc = { id: 't-ext', category: 'externally_visible', probe_kind: 'url', target: 'https://github.com/x/y/pull/1' };
    const r = await evaluateAssertion(desc, {}, {});
    expect(r.status).toBe('UNDECIDABLE');
    expect(r.status).not.toBe('PASS');
  });

  it('runCellContracts 未知格标识抛错，不静默 PASS', async () => {
    await expect(runCellContracts('bogus_cell', {}, {})).rejects.toThrow(/unknown_cell/);
  });

  it('runCellContracts 存在 FAIL 或 UNDECIDABLE 时 ok=false', async () => {
    // 用 generate 格（含 record_persisted），不给 resolver → 至少一条 UNDECIDABLE → ok=false
    const res = await runCellContracts('generate', { candidate: { ...VALID_CANDIDATE } }, {});
    expect(res.cell).toBe('generate');
    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.ok).toBe(false);
  });
});
