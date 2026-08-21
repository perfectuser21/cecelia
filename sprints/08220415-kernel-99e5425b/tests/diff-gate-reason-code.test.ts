/**
 * Sprint 08220415-kernel-99e5425b — Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 [r42]
 *
 * 复现 bug：evaluateDiffGate 步骤 3a 把 Mapper 任意非 fresh freshness 一律折叠成裸
 *          `mapper_stale` + `retryable: true`；确定性结论（no_anchor/revision_mismatch/
 *          resolver_error 等）本应 fail-closed 停机，却被当瞬时无限重试 → run 空转。
 *
 * 冻结回归（永久留 CI）：
 *   - 确定性码透传进 reason_code 且 retryable=false（fail-closed）
 *   - 瞬时白名单（fact_snapshot_stale/projection_revision_missing）与 null 保留 retryable=true
 *   - gateReceipt diff deny 标签透传具体 reason_code，不再裸 mapper_stale
 *
 * 禁 mock 被改的边（v9.12）：真实调用 evaluateDiffGate 与 gateReceipt（经真实
 *   createHarnessImpactGates.beforeEvaluate），仅 mock 外层边界 mapClient(Mapper HTTP)/
 *   db(Postgres)/getActiveContract/readChangedFiles/diffGate(作为 gateReceipt 输入边界)。
 *   本 run postgres=false，被改的两条边均为纯内存决策/透传，db 作外层边界 mock 合规。
 */

import { describe, it, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_REV = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

// ── 外层边界：受控 db（Postgres 边界，postgres=false 下 mock 合规）返回 active contract ──
function makeDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        repo: 'cecelia',
        base_revision: BASE_REV,
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

// ── 外层边界：Mapper HTTP（mapClient）返回受控 freshness shape 驱动真实 3a 分支 ──
function makeMapper(freshness: unknown) {
  return async () => {
    const res: Record<string, unknown> = {
      affected_nodes: [],
      required_assertions: [],
    };
    if (freshness !== undefined) res.freshness = freshness;
    return res;
  };
}

describe('Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口', () => {

  it('B-01 确定性 reason_code no_anchor 走 fail-closed 出口 retryable=false', async () => {
    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: TASK_ID,
      mapClient: makeMapper({ status: 'stale', reason_code: 'no_anchor' }),
      headRevision: HEAD_SHA,
      repo: 'cecelia',
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    // 透传具体码，不再丢弃成裸 mapper_stale
    expect(result.reason_code).toBe('no_anchor');
    // 确定性码 fail-closed：停止无限重试
    expect(result.retryable).toBe(false);
  });

  it('B-02 瞬时白名单 fact_snapshot_stale 与 projection_revision_missing 保留 retryable=true', async () => {
    for (const code of ['fact_snapshot_stale', 'projection_revision_missing']) {
      const result = await evaluateDiffGate({
        db: makeDb(),
        taskId: TASK_ID,
        mapClient: makeMapper({ status: 'stale', reason_code: code }),
        headRevision: HEAD_SHA,
        repo: 'cecelia',
        changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
      });
      expect(result.gate).toBe('impact_unknown');
      expect(result.reason_code).toBe(code);
      // 瞬时白名单：保留可重试
      expect(result.retryable).toBe(true);
    }
  });

  it('B-03 freshness 缺失 reason_code=null 保留 retryable=true', async () => {
    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: TASK_ID,
      mapClient: makeMapper(undefined), // 无 freshness 字段
      headRevision: HEAD_SHA,
      repo: 'cecelia',
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBeNull();
    // freshness 缺失保守当瞬时
    expect(result.retryable).toBe(true);
  });

  it('B-04 gateReceipt diff deny 标签透传具体 reason_code 不再裸 mapper_stale', async () => {
    const active = {
      id: 'contract-1',
      repo: 'cecelia',
      base_revision: BASE_REV,
      contract_hash: 'c'.repeat(64),
    };
    // diffGate 作为 gateReceipt 的上游输入边界注入确定性结果；gateReceipt 全程真实执行
    const diffGate = vi.fn().mockResolvedValue({
      gate: 'impact_unknown',
      reason_code: 'no_anchor',
      retryable: false,
      contract: active,
    });
    const readChangedFiles = vi.fn().mockResolvedValue([
      'packages/brain/src/impact-contract/diff-gate.js',
    ]);
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      diffGate,
      readChangedFiles,
    });

    const receipt = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: { head_sha: HEAD_SHA },
    });

    expect(receipt.stage).toBe('diff');
    expect(receipt.gate).toBe('impact_unknown');
    // deny 标签归因到具体 reason_code
    expect(receipt.reason_code).toBe('no_anchor');
    expect(receipt.reason).toBe('no_anchor');
    // 关键：不再裸 mapper_stale
    expect(receipt.reason).not.toBe('mapper_stale');
  });

  it('B-05 未知 reason_code 归确定性 fail-closed retryable=false', async () => {
    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: TASK_ID,
      mapClient: makeMapper({ status: 'stale', reason_code: 'some_unknown_code' }),
      headRevision: HEAD_SHA,
      repo: 'cecelia',
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('some_unknown_code');
    // 白名单外默认 fail-closed，宁停勿空转
    expect(result.retryable).toBe(false);
  });

});
