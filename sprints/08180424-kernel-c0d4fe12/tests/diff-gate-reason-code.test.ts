/**
 * Sprint 08180424-kernel-c0d4fe12 — Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19）
 *
 * TDD Red 脚手架：本文件与 packages/brain/src/impact-contract/__tests__/diff-gate.test.js 的
 * 新增断言同源。运行在仓库根（sprints/** 在根 vitest.config.js include 内）。
 *
 * 被测：evaluateDiffGate 步骤 3a —— 当 mapperResult.freshness.status !== 'fresh' 时，
 *   把 Mapper 的 freshness.reason_code 透传到返回的 reason / reason_code，
 *   并按「确定性 vs 瞬态」分类 retryable：
 *     确定性结构码（radius.js 产出的 projection/manifest/graph/capability/assertion 系列）→ retryable:false（fail-closed 终态）
 *     瞬态码 fact_snapshot_stale 或 reason_code 缺失 → retryable:true（向后兼容旧 mapper_stale 路径）
 *
 * 策略：真实 evaluateDiffGate（不 stub），仅注入 db-read（contract 读取）与 mapClient（radius，PRD 明确不在范围内）。
 *   被改的分类逻辑本体真跑。见合同「## 禁 mock 边清单」。
 */
import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 注入返回单个 active contract 的 db-read（步骤 3a 在读取后、写副作用前即返回，无 DB 写路径触达）
function dbWithContract() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-r19',
        task_id: 'task-r19',
        repo: 'cecelia',
        base_revision: 'base',
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

// 复刻 radius.js 真实产出的 freshness envelope 形状（已逐码核对 packages/brain/src/map/radius.js baseFreshness + 步骤 261-396）
function mapClientWithFreshness(freshness) {
  return vi.fn(async () => ({
    freshness,
    fact_revisions: { cecelia: 'base' },
    affected_nodes: [],
    required_assertions: [],
  }));
}

async function runGate(freshness) {
  return evaluateDiffGate({
    db: dbWithContract(),
    taskId: 'task-r19',
    repo: 'cecelia',
    headRevision: 'head',
    mapClient: mapClientWithFreshness(freshness),
    changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
  });
}

describe('Diff Impact Gate 步骤 3a — 确定性 reason_code 透传 + fail-closed [BEHAVIOR]', () => {
  test('B-01 确定性 stale 码 projection_revision_mismatch 透传且 retryable=false（fail-closed 终态）', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('projection_revision_mismatch');
    expect(result.reason_code).toBe('projection_revision_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('B-02 确定性 unknown 码 capability_not_in_active_projection 透传且 retryable=false', async () => {
    const result = await runGate({ status: 'unknown', reason_code: 'capability_not_in_active_projection' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('capability_not_in_active_projection');
    expect(result.reason_code).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  test('B-03 瞬态码 fact_snapshot_stale 保持 retryable=true（不被误 fail-closed 挡死）', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
  });

  test('B-04 向后兼容：freshness 存在但 reason_code=null 回退 mapper_stale + retryable=true', async () => {
    const result = await runGate({ status: 'stale', reason_code: null });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('B-05 边界不变：freshness 缺失回退 mapper_stale + retryable=true（行为不变）', async () => {
    const result = await evaluateDiffGate({
      db: dbWithContract(),
      taskId: 'task-r19',
      repo: 'cecelia',
      headRevision: 'head',
      mapClient: vi.fn(async () => ({
        fact_revisions: { cecelia: 'base' },
        affected_nodes: [],
        required_assertions: [],
      })),
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });
});
