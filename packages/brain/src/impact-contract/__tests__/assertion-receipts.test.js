import { describe, expect, it, vi } from 'vitest';

import { persistTrustedEvaluatorReceipts } from '../assertion-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';
const HEAD_SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const ASSERTION_ID = 'packages/brain/src/assert-1.test.js';
const ASSERTION_COMMAND = `npx vitest run ${ASSERTION_ID}`;
const ASSERTION_ARGV = ['npx', 'vitest', 'run', ASSERTION_ID];

function attempt() {
  return {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    role: 'evaluator',
    actual_machine_id: 'us-mac-m4',
    task_bundle: {
      inputs: {
        pull_request: { head_sha: HEAD_SHA },
        impact_gate: {
          contract_id: CONTRACT_ID,
          contract_hash: 'c'.repeat(64),
          repo: 'perfectuser21/cecelia',
        },
        required_assertions: [{
          assertion_id: ASSERTION_ID,
          command: ASSERTION_COMMAND,
          covers_capability_ids: ['brain'],
          journey_step_link_id: LINK_ID,
          assertion_revision: 1,
          assertion_digest: DIGEST,
        }],
      },
    },
  };
}

function result(check = {}) {
  return {
    status: 'completed',
    decision: { outcome: 'PASS' },
    checks: [{
      assertion_id: ASSERTION_ID,
      command_argv: ASSERTION_ARGV,
      journey_step_link_id: LINK_ID,
      assertion_revision: 1,
      assertion_digest: DIGEST,
      exit_code: 0,
      output_digest: 'd'.repeat(64),
      output_tail: 'all green',
      scenario_count: 1,
      scenario_evidence: {
        pr_head_sha: HEAD_SHA,
        machine: 'us-mac-m4',
        cases: [ASSERTION_ID],
      },
      started_at: '2026-08-11T04:00:00.000Z',
      completed_at: '2026-08-11T04:01:00.000Z',
      ...check,
    }],
  };
}

describe('trusted evaluator assertion receipt writer', () => {
  it('从已认证 evaluator callback 写 append-only receipt', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: 'receipt-1' }] })) };

    const receipts = await persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result(),
    });

    expect(receipts).toEqual([{ id: 'receipt-1' }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO journey_assertion_receipts');
    expect(sql).toMatch(/ON CONFLICT \(\s*run_id, journey_step_link_id, source_sha, impact_contract_hash\s*\)/);
    expect(params).toEqual(expect.arrayContaining([
      RUN_ID, ATTEMPT_ID, LINK_ID, HEAD_SHA, CONTRACT_ID, 'c'.repeat(64),
    ]));
  });

  it('FIXED 按 Harness 既有语义归一为 PASS，断言真实通过后生成 receipt', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: 'receipt-fixed' }] })) };
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: { ...result(), decision: { outcome: 'FIXED' } },
    })).resolves.toEqual([{ id: 'receipt-fixed' }]);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('同一命令一次可信执行为所有 Journey source binding 写独立 receipt', async () => {
    const secondLink = '55555555-5555-4555-8555-555555555555';
    const aggregated = attempt();
    aggregated.task_bundle.inputs.required_assertions[0].source_bindings = [
      { journey_step_link_id: LINK_ID, assertion_revision: 1, assertion_digest: DIGEST },
      { journey_step_link_id: secondLink, assertion_revision: 3, assertion_digest: DIGEST },
    ];
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'receipt-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'receipt-2' }] }) };

    const receipts = await persistTrustedEvaluatorReceipts(db, {
      attempt: aggregated,
      result: result(),
    });

    expect(receipts).toEqual([{ id: 'receipt-1' }, { id: 'receipt-2' }]);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][1]).toEqual(expect.arrayContaining([secondLink, 3]));
  });

  it('缺断言证据或命令被替换时拒绝 evaluator PASS', async () => {
    const db = { query: vi.fn() };
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: { ...result(), checks: [] },
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result({ command_argv: ['bash', 'scripts/smoke/other.sh'] }),
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('拒绝重复/多余 checks 及未绑定当前 SHA、机器、合同身份的证据', async () => {
    const db = { query: vi.fn() };
    const valid = result().checks[0];
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: { ...result(), checks: [valid, valid] },
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result({ scenario_evidence: {
        pr_head_sha: 'f'.repeat(40), machine: 'us-mac-m4', cases: ['assert-1'],
      } }),
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result({ journey_step_link_id: '55555555-5555-4555-8555-555555555555' }),
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    expect(db.query).not.toHaveBeenCalled();
  });
});
