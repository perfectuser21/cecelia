import { describe, expect, it, vi } from 'vitest';

import { persistTrustedEvaluatorReceipts } from '../../../packages/brain/src/impact-contract/assertion-receipts.js';

// TDD RED — 冻结 GP Contract identity 贯穿 persistTrustedEvaluatorReceipts。
// 当前实现忽略 inputs.gp_contract、不 fail-closed、INSERT 不带 gp_contract_id/hash → 本文件多条为红。

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';
// 冻结的 GP Contract identity（来自 tasks.payload.gp_contract_*）
const GP_CONTRACT_ID = '66666666-6666-4666-8666-666666666666';
const GP_CONTRACT_HASH = 'e'.repeat(64);
const GP_CONTRACT_VERSION = 2;
// 同 Journey 存在一个更新的 signed GP（串绑陷阱：writer 不得落到它头上）
const NEWER_GP_ID = '77777777-7777-4777-8777-777777777777';
const NEWER_GP_HASH = 'f'.repeat(64);
const HEAD_SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const ASSERTION_ID = 'packages/brain/src/assert-1.test.js';
const ASSERTION_COMMAND = `npx vitest run ${ASSERTION_ID}`;
const ASSERTION_ARGV = ['npx', 'vitest', 'run', ASSERTION_ID];

function attempt(gpOverrides = {}) {
  const gp = gpOverrides.gp_contract === null
    ? undefined
    : {
        id: GP_CONTRACT_ID,
        version: GP_CONTRACT_VERSION,
        hash: GP_CONTRACT_HASH,
        ...(gpOverrides.gp_contract ?? {}),
      };
  const inputs = {
    pull_request: { head_sha: HEAD_SHA },
    impact_gate: {
      contract_id: CONTRACT_ID,
      contract_hash: 'c'.repeat(64),
      repo: 'perfectuser21/cecelia',
    },
    gp_contract_required: gpOverrides.gp_contract_required ?? true,
    required_assertions: [{
      assertion_id: ASSERTION_ID,
      command: ASSERTION_COMMAND,
      covers_capability_ids: ['brain'],
      journey_step_link_id: LINK_ID,
      assertion_revision: 1,
      assertion_digest: DIGEST,
    }],
  };
  if (gp) inputs.gp_contract = gp;
  return {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    role: 'evaluator',
    actual_machine_id: 'us-mac-m4',
    task_bundle: { inputs },
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

// db mock：SELECT golden_path_contract_versions 返回冻结 GP 的 signed 行；INSERT 返回 receipt。
function makeDb({ signedRows = [{ id: GP_CONTRACT_ID, content_hash: GP_CONTRACT_HASH, status: 'signed' }] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/golden_path_contract_versions/i.test(sql)) return { rows: signedRows };
      return { rows: [{ id: 'receipt-1' }] };
    }),
  };
}

describe('冻结 GP identity 贯穿 receipt writer [BEHAVIOR]', () => {
  it('冻结 GP identity 精确落库到 gp_contract_id/gp_contract_hash', async () => {
    const db = makeDb();
    const receipts = await persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result(),
    });
    expect(receipts.length).toBe(1);
    const insertCall = db.query.mock.calls.find(([sql]) => /INSERT INTO journey_assertion_receipts/i.test(sql));
    expect(insertCall).toBeTruthy();
    // 冻结的 gp_contract_id + gp_contract_hash 必须进入 INSERT 参数
    expect(insertCall[1]).toEqual(expect.arrayContaining([GP_CONTRACT_ID, GP_CONTRACT_HASH]));
    // 反串绑：更新的 signed GP 绝不能落库
    expect(insertCall[1]).not.toContain(NEWER_GP_ID);
    expect(insertCall[1]).not.toContain(NEWER_GP_HASH);
  });

  it('gp_contract_required 但冻结 identity 缺失 → fail-closed 抛错，不落半条', async () => {
    const db = makeDb();
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt({ gp_contract: null }),
      result: result(),
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    const insertCall = db.query.mock.calls.find(([sql]) => /INSERT INTO journey_assertion_receipts/i.test(sql));
    expect(insertCall).toBeUndefined();
  });

  it('冻结 hash 与 DB signed GP content_hash 不一致（串绑）→ fail-closed 抛错', async () => {
    // DB 里冻结 gp_contract_id 对应的 signed 行 hash 与 bundle 冻结 hash 不符 → 拒绝
    const db = makeDb({ signedRows: [{ id: GP_CONTRACT_ID, content_hash: NEWER_GP_HASH, status: 'signed' }] });
    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result(),
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
    const insertCall = db.query.mock.calls.find(([sql]) => /INSERT INTO journey_assertion_receipts/i.test(sql));
    expect(insertCall).toBeUndefined();
  });

  it('gp_contract_required=false（legacy 无冻结 GP）→ 保持 NULL 落库，零回归', async () => {
    const db = makeDb();
    const receipts = await persistTrustedEvaluatorReceipts(db, {
      attempt: attempt({ gp_contract: null, gp_contract_required: false }),
      result: result(),
    });
    expect(receipts.length).toBe(1);
    const insertCall = db.query.mock.calls.find(([sql]) => /INSERT INTO journey_assertion_receipts/i.test(sql));
    expect(insertCall[1]).not.toContain(GP_CONTRACT_ID);
  });
});
