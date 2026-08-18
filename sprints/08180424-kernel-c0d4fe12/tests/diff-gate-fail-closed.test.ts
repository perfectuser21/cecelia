/**
 * Sprint 08180424-kernel-c0d4fe12 — Diff Impact Gate 透传 reason_code + fail-closed 出口（r19）
 *
 * TDD Red 证据 + 永久回归（另一份同规格断言由 generator 落进
 * packages/brain/src/impact-contract/__tests__/diff-gate.test.js，进 brain-ci 永久回归）。
 *
 * 禁 mock 被改的边：
 *  - 调真实 evaluateDiffGate（禁 vi.mock('../diff-gate.js') / 禁 stub 本体），只注入 mapClient（Mapper 外部依赖，
 *    本 sprint 无真实 Mapper 配置）+ fake 合同 db（更外层 contract-store，非改动边）。
 *  - reason_code/retryable 跨模块接力：经真实 createHarnessImpactGates().beforeEvaluate 跑真实 gateReceipt，
 *    禁止 mock gateReceipt / beforeEvaluate。
 *
 * 无 Postgres：3a 短路发生在任何 DB 写入之前；fake db.query 仅回 contract 行（getActiveImpactContract 用）。
 */
import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const BASE = 'base';

// fake 合同 db（更外层 contract-store，非本单改动边）——供 evaluateDiffGate 步骤1 与 beforeEvaluate 用
function makeContractDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        task_id: 'task-001',
        repo: 'cecelia',
        base_revision: BASE,
        contract_hash: 'c'.repeat(64),
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

// 真实 Mapper 会返回的 freshness 形态（不同 status / reason_code），只注入这一个外部依赖
function mapClientWith(freshness: any) {
  return vi.fn().mockResolvedValue({
    freshness,
    affected_nodes: [],
    required_assertions: [],
    fact_revisions: { cecelia: BASE },
  });
}

describe('Diff Impact Gate fail-closed — 透传 reason_code + 终态出口', () => {
  // B-01：确定性终态（status=unknown）→ 透传真实 reason_code + retryable=false（不再折叠成 mapper_stale 空转）
  test('B-01 status=unknown 的确定性结论 → reason_code 透传 + retryable=false（fail-closed）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-001',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: mapClientWith({ status: 'unknown', reason_code: 'impact_anchor_missing' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('impact_anchor_missing');
    expect(result.reason).toBe('impact_anchor_missing'); // gateReceipt/loop 由此得 deny:impact:impact_anchor_missing
    expect(result.retryable).toBe(false);
  });

  // B-02：瞬态 stale 且 reason_code=null → 保持 mapper_stale/retryable=true（不得因缺 code 误判假 block）
  test('B-02 status=stale 且 reason_code=null → 保留 mapper_stale + retryable=true（瞬态语义不变）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-001',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: mapClientWith({ status: 'stale', reason_code: null }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.reason_code).toBe(null);
    expect(result.retryable).toBe(true);
  });

  // B-03：瞬态 stale 且带自愈 reason_code → 透传 reason_code + 仍 retryable=true（观测增强、重试语义不变）
  test('B-03 status=stale 且 reason_code=fact_snapshot_stale → 透传 code + retryable=true', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-001',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: mapClientWith({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.reason).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
  });

  // B-04：确定性/终态码集合成员（即使 status 恰为 stale 也判终态）——码集合由 proposer 依 radius.js unknown 分支确定
  test('B-04 终态 reason_code 集合成员 → retryable=false（capability_not_in_active_projection）', async () => {
    const result = await evaluateDiffGate({
      db: null,
      taskId: 'task-001',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: mapClientWith({ status: 'unknown', reason_code: 'capability_not_in_active_projection' }),
    });
    expect(result.reason_code).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  // B-05：跨模块接力——真实 evaluateDiffGate → 真实 gateReceipt（beforeEvaluate）→ receipt 抵达 loop 的字段
  test('B-05 reason_code/retryable 经真实 gateReceipt 抵达（loop 侧据此判 impact_contract_invalid 终态）', async () => {
    const db = makeContractDb();
    const gates = createHarnessImpactGates({
      db,
      getActiveContract: vi.fn().mockResolvedValue({
        id: 'contract-1', task_id: 'task-001', repo: 'cecelia',
        base_revision: BASE, contract_hash: 'c'.repeat(64),
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }),
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/impact-contract/diff-gate.js']),
      // 注入真实 evaluateDiffGate（改动边不 mock），只把 Mapper 外部依赖注入进去
      diffGate: (args: any) => evaluateDiffGate({
        ...args,
        mapClient: mapClientWith({ status: 'unknown', reason_code: 'impact_anchor_missing' }),
      }),
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-001', payload: {} },
      pr: { head_sha: 'a'.repeat(40) },
      run: { id: 'run-1', impact_contract_policy: 'required' },
    });
    expect(receipt.gate).toBe('impact_unknown');
    expect(receipt.reason).toBe('impact_anchor_missing'); // → deny:impact:impact_anchor_missing
    expect(receipt.retryable).toBe(false);                // → failure_class=impact_contract_invalid（终态）
  });
});
