// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Runner 后置断言回执 ↔ Brain 回执校验的 source_sha
//
// 2026-08-20 生产实证（run 767e73b2 attempt 76800dda，r21 以来第二轮 evaluator 全部死亡的总根因）：
//   generator-fix 在候选上追加 commit（新头 bd987c0b），远端 PR 仍指向旧头 e1dca722。
//   Runner 在 exact 候选头上后置执行 required_assertions，回执里 pr_head_sha=bd987c0b（正确）。
//   而 assertion-receipts 的 sourceSha 取值是 `pull_request?.head_sha ?? impact_gate.head_revision`
//   ——PR 旧头优先 → 与回执比对失败 → 409 assertion_receipt_evidence_invalid →
//   容器判永久拒绝 exit 75 → attempt 死 → 重试同死 → 双账号 cycle 耗尽 → run 死。
//   dispatcher.js 早修过同款（"远端 PR 可能仍指向旧头，不能覆盖候选身份"），此处漏了。
//
// 按产物闸规矩写在边上：真 persistTrustedEvaluatorReceipts（不 vi.mock 被改模块），只注入 db。
import { describe, expect, it, vi } from 'vitest';
import { persistTrustedEvaluatorReceipts } from '../../../packages/brain/src/impact-contract/assertion-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';
const STALE_PR_HEAD = 'e1dca7223eeb0292b94c390871a2e5d9bcc1d7f5'; // 第一轮 publish 时的远端 PR 头
const CANDIDATE_HEAD = 'bd987c0b4e13dade588eed1601e8020c8730de55'; // generator-fix 后的候选头
const DIGEST = 'b'.repeat(64);
const ASSERTION_ID = 'packages/brain/src/orchestrator/__tests__/ground-truth.test.js';
const ASSERTION_ARGV = ['npx', 'vitest', 'run', ASSERTION_ID];

function attempt() {
  return {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    role: 'evaluator',
    actual_machine_id: 'us-mac-m4',
    task_bundle: {
      inputs: {
        // 生产真实形状（r29 attempt 76800dda 逐字段照抄结构）：
        // PR 观测滞后于候选——这是本地候选流的常态，不是异常
        pull_request: { head_sha: STALE_PR_HEAD },
        candidate: { head_sha: CANDIDATE_HEAD },
        impact_gate: {
          contract_id: CONTRACT_ID,
          contract_hash: 'c'.repeat(64),
          repo: 'perfectuser21/cecelia',
          head_revision: CANDIDATE_HEAD, // 闸门真实验的 revision = 候选头
        },
        required_assertions: [{
          assertion_id: ASSERTION_ID,
          command: `npx vitest run ${ASSERTION_ID}`,
          covers_capability_ids: ['brain'],
          journey_step_link_id: LINK_ID,
          assertion_revision: 1,
          assertion_digest: DIGEST,
        }],
      },
    },
  };
}

function result() {
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
        // Runner 在 exact 候选头上执行——这是**正确**的证据
        pr_head_sha: CANDIDATE_HEAD,
        machine: 'us-mac-m4',
        cases: [ASSERTION_ID],
      },
      started_at: '2026-08-20T08:20:00.000Z',
      completed_at: '2026-08-20T08:21:00.000Z',
    }],
  };
}

describe('F1 step3 — fix 后回执以候选头为准，不被滞后的远端 PR 头 409', () => {
  it('PR 头滞后 + 回执带候选头 → 必须通过（生产 76800dda 之死）', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'receipt-1' }] }) };

    const receipts = await persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: result(),
    });

    expect(receipts).toEqual([{ id: 'receipt-1' }]);
    // receipt 的 source_sha 必须是候选头（真被验的那个），不是滞后的 PR 头
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO journey_assertion_receipts'));
    expect(insert[1]).toContain(CANDIDATE_HEAD);
    expect(insert[1]).not.toContain(STALE_PR_HEAD);
  });

  it('负向：回执带的头与候选头都对不上（真造假）→ 仍 409', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'x' }] }) };
    const bad = result();
    bad.checks[0].scenario_evidence.pr_head_sha = 'f'.repeat(40);

    await expect(persistTrustedEvaluatorReceipts(db, {
      attempt: attempt(),
      result: bad,
    })).rejects.toMatchObject({ code: 'assertion_receipt_evidence_invalid' });
  });

  it('负向：无候选流（纯 PR，无 head_revision/candidate）→ 仍按 PR 头校验', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'y' }] }) };
    const a = attempt();
    delete a.task_bundle.inputs.candidate;
    a.task_bundle.inputs.impact_gate.head_revision = undefined;
    a.task_bundle.inputs.pull_request.head_sha = CANDIDATE_HEAD; // 纯 PR 流两者一致
    const receipts = await persistTrustedEvaluatorReceipts(db, { attempt: a, result: result() });
    expect(receipts).toEqual([{ id: 'y' }]);
  });
});
