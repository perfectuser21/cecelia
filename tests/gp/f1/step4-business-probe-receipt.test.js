// F1「工厂 · 开发闭环」步骤 4「交付有回执」—— 边：run.finished 判定 × journey_assertion_receipts 回执线
//
// 棒3a 判定（任务 33aa2bc4，决策 702949b6 / 95e29afd）：task_runs 只记"活动发生了"，
// 本棒把 step_probes 的 expect 与 task_runs.result.probes 的 observed 对起来，判定结果写进
// 回执账本（executor_kind=business_probe_runner，迁移 474 放行）并翻 cell_status。
//
// 这条边的矛盾只能在真零件上撞出来：judge 组装的 evidence/verdict 必须被
// persistBusinessProbeReceipt 原样接住（字段顺序、exit_code、probe:<key>、占位 source_repo），
// 任何一侧 mock 掉都看不见。真 import 被改模块 assertion-receipts.js（守卫在边上），不 mock 它。
import { describe, it, expect, vi } from 'vitest';
import {
  persistBusinessProbeReceipt,
  BUSINESS_PROBE_EXECUTOR_KIND,
  BUSINESS_PROBE_SOURCE_REPO,
} from '../../../packages/brain/src/impact-contract/assertion-receipts.js';
import { handleRunFinished } from '../../../packages/brain/src/lib/business-probe-judge.js';

const LINK_A = '11111111-1111-4111-8111-111111111111';
const LINK_B = '22222222-2222-4222-8222-222222222222';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function probeSpec(key, expect_, { link = LINK_A, hash = HASH_A, severity = 'error' } = {}) {
  return {
    probe_key: key, stage: 'delivery', severity, spec_hash: hash,
    journey_step_link_id: link, assertion_revision: 2,
    spec: { key, stage: 'delivery', journey_cell: 'stage:delivery', probe: { kind: 'sql' }, expect: expect_, severity },
  };
}

function makePool(specs) {
  const receipts = [];
  const cellUpdates = [];
  const pool = {
    query: vi.fn(async (sql, params) => {
      if (/FROM tasks/.test(sql)) return { rows: [{ journey_id: 'afa6abca-53c0-4815-8594-b7fb81ca547f' }] };
      if (/FROM step_probes/.test(sql)) return { rows: specs };
      if (/INSERT INTO journey_assertion_receipts/.test(sql)) {
        receipts.push({ sql, params });
        return { rows: [{ id: `rcpt-${receipts.length}`, verdict: params[9] }] };
      }
      if (/UPDATE journey_step_links/.test(sql)) { cellUpdates.push(params); return { rows: [] }; }
      return { rows: [] };
    }),
  };
  return { pool, receipts, cellUpdates };
}

describe('F1 step4 交付有回执 — run.finished 判定线真零件走通', () => {
  it('judge 组装的证据被 persistBusinessProbeReceipt 原样接住：PASS→exit 0/green，FAIL(error)→exit 1/red', async () => {
    const specs = [
      probeSpec('delivery.posts_visible', { op: '>=', ref: 'metrics.expected_posts' }),
      probeSpec('delivery.receipt_ids', { op: 'not_null_all' }, { link: LINK_B, hash: HASH_B }),
    ];
    const { pool, receipts, cellUpdates } = makePool(specs);
    const out = await handleRunFinished({
      runId: 'run-delivery-1', taskId: 't-1', status: 'success',
      result: {
        stage: 'delivery', stage_status: 'ok', metrics: { expected_posts: 2 }, evidence: {},
        probes: [
          { key: 'delivery.posts_visible', observed: 2, probed_at: '2026-09-26T12:00:00.000Z' },
          { key: 'delivery.receipt_ids', observed: ['a', null] },
        ],
      },
    }, { pool, persist: persistBusinessProbeReceipt });

    expect(out).toMatchObject({ judged: 2, cells: { [LINK_A]: 'green', [LINK_B]: 'red' } });
    expect(receipts).toHaveLength(2);

    const pass = receipts[0];
    expect(pass.sql).toMatch(new RegExp(`'${BUSINESS_PROBE_EXECUTOR_KIND}'`));
    expect(pass.sql).toMatch(/ON CONFLICT \(run_id, journey_step_link_id, source_sha, impact_contract_hash\) DO NOTHING/);
    expect(pass.params).toEqual([
      LINK_A, 'run-delivery-1', 2, 'probe:delivery.posts_visible', HASH_A,
      BUSINESS_PROBE_SOURCE_REPO, null,
      JSON.stringify(['probe', 'delivery.posts_visible']),
      JSON.stringify({ observed: 2, expected: 2, op: '>=', severity: 'error' }),
      'PASS', 0,
      '2026-09-26T12:00:00.000Z', '2026-09-26T12:00:00.000Z',
      null,
    ]);

    const fail = receipts[1];
    expect(fail.params[3]).toBe('probe:delivery.receipt_ids');
    expect(fail.params[4]).toBe(HASH_B);
    expect(fail.params[9]).toBe('FAIL');
    expect(fail.params[10]).toBe(1);
    expect(JSON.parse(fail.params[8])).toEqual({
      observed: ['a', null], expected: null, op: 'not_null_all', severity: 'error', reason: 'value_mismatch',
    });

    expect(cellUpdates).toEqual([['green', LINK_A], ['red', LINK_B]]);
    expect(out.receipts.map((r) => r.receipt_id)).toEqual(['rcpt-1', 'rcpt-2']);
  });

  it('observed 缺失也必须留回执（FAIL probe_missing），warn 档翻 pending 而不是 red', async () => {
    const specs = [probeSpec('delivery.optional_metric', { op: '<=', value: 5 }, { severity: 'warn' })];
    const { pool, receipts, cellUpdates } = makePool(specs);
    const out = await handleRunFinished({
      runId: 'run-delivery-2', taskId: 't-1', status: 'failed',
      result: { stage: 'delivery', metrics: {}, probes: [] },
    }, { pool, persist: persistBusinessProbeReceipt });
    expect(out.cells[LINK_A]).toBe('pending');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].params[9]).toBe('FAIL');
    expect(JSON.parse(receipts[0].params[8]).reason).toBe('probe_missing');
    expect(cellUpdates).toEqual([['pending', LINK_A]]);
  });

  it('回执写入抛错（约束拒绝等）不外溢到 finishRun 调用方：返回 {error} 且不翻色', async () => {
    const specs = [probeSpec('delivery.x', { op: '==', value: 1 }, { hash: 'not-a-digest' })];
    const { pool, cellUpdates } = makePool(specs);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await handleRunFinished({
      runId: 'run-delivery-3', taskId: 't-1', status: 'success',
      result: { stage: 'delivery', probes: [{ key: 'delivery.x', observed: 1 }] },
    }, { pool, persist: persistBusinessProbeReceipt });
    expect(out.error).toMatch(/spec_hash/);
    expect(cellUpdates).toEqual([]);
    warn.mockRestore();
  });
});
