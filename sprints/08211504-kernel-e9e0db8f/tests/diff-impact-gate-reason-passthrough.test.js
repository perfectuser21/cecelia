/**
 * Sprint 冻结回归测试 — Diff Impact Gate 透传 reason_code + 确定性终态 fail-closed 出口（r19/r38）
 *
 * 背景：Diff Impact Gate（diff-gate.js）/ Structure Gate（structure-gate.js）把 Mapper 的
 * 确定性终态结论（稳定的 digest/revision mismatch，重试永不收敛）标成 retryable:true，
 * 导致 attempt 反复落 deny:impact:* 被无限重派、run 空转（runs f62c7e87 / d1360a48）。
 *
 * 本文件断言修复后的可观测行为（先红后绿）：
 *   1. 确定性终态（projection/manifest/revision digest 稳定 mismatch）→ 透传具体 reason_code
 *      且 retryable=false（fail-closed 出口）。
 *   2. 基础设施类瞬态（mapper_unavailable / db 不可达 / mapper_stale / revision_evidence_missing）
 *      → 保持 retryable=true（不被误判为终态过早 fail-closed）。
 *   3. 未知/未枚举 reason_code → 默认 fail-closed（retryable=false）并透传原始 reason_code。
 *   4. structure-gate 同源折叠对齐（终态不再折叠成笼统 mapper_stale、retryable=false）。
 *
 * 验证策略与 packages/brain/src/impact-contract/__tests__ 一致：注入 mock db（query fn）
 * 与依赖注入的 mapClient 构造确定性 Mapper 投影，不需要真实 Postgres。被改的边——
 * Gate 内部的 reason 分类逻辑——真实执行，不 mock。
 */

import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

// ── 辅助：构造带指定 digest/revision 的 active contract db mock ──
function makeContractDb({
  baseRevision = 'base',
  manifestDigest = null,
  projectionDigest = null,
} = {}) {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        repo: 'cecelia',
        change_kind: 'bugfix',
        base_revision: baseRevision,
        ...(manifestDigest ? { manifest_digest: manifestDigest } : {}),
        ...(projectionDigest ? { projection_digest: projectionDigest } : {}),
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

function makeStructureContract() {
  return {
    task_id: 't-struct',
    change_kind: 'bugfix',
    repo: 'cecelia',
    base_revision: 'abc1234abc1234abc1234abc1234abc1234abc12',
    affected_capabilities: [{ capability_id: 'cap-001' }],
    required_assertions: [],
    contract_body: {
      task_id: 't-struct',
      change_kind: 'bugfix',
      base_revision: 'abc1234abc1234abc1234abc1234abc1234abc12',
      affected_capabilities: [{ capability_id: 'cap-001' }],
      required_assertions: [],
    },
  };
}

describe('Diff Impact Gate 确定性终态 fail-closed 出口', () => {

  test('终态 projection_digest_mismatch 透传具体 reason_code 且 retryable=false', async () => {
    const db = makeContractDb({ manifestDigest: 'm1', projectionDigest: 'p1' });
    const result = await evaluateDiffGate({
      db, taskId: 't-proj', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        manifest_digest: 'm1', projection_digest: 'p_DRIFTED',
        fact_revisions: { cecelia: 'base' }, freshness: { status: 'fresh' },
        affected_nodes: [], required_assertions: [],
      }),
    });
    // 透传：不折叠成笼统 mapper_stale
    expect(result.reason).toBe('projection_digest_mismatch');
    // fail-closed：确定性终态不可重试
    expect(result.retryable).toBe(false);
    expect(result.gate).toBe('impact_unknown');
  });

  test('终态 manifest_digest_mismatch 透传具体 reason_code 且 retryable=false', async () => {
    const db = makeContractDb({ manifestDigest: 'm1', projectionDigest: 'p1' });
    const result = await evaluateDiffGate({
      db, taskId: 't-man', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        manifest_digest: 'm_DRIFTED', projection_digest: 'p1',
        fact_revisions: { cecelia: 'base' }, freshness: { status: 'fresh' },
        affected_nodes: [], required_assertions: [],
      }),
    });
    expect(result.reason).toBe('manifest_digest_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('终态 revision_mismatch 透传具体 reason_code 且 retryable=false', async () => {
    const db = makeContractDb({ baseRevision: 'base123' });
    const result = await evaluateDiffGate({
      db, taskId: 't-rev', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'fresh' }, affected_nodes: [], required_assertions: [],
        fact_revisions: { cecelia: 'stale999' },
      }),
    });
    expect(result.reason).toBe('revision_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('瞬态 mapper_unavailable 保持 retryable=true（不被误判为终态）', async () => {
    const result = await evaluateDiffGate({
      db: null, taskId: 't-unavail',
      mapClient: async () => { throw new Error('ETIMEDOUT: Mapper request timed out'); },
      changedFiles: ['packages/brain/src/tick.js'],
    });
    expect(result.reason).toBe('mapper_unavailable');
    expect(result.retryable).toBe(true);
  });

  test('瞬态 mapper_stale（freshness 未 fresh 且无具体 reason_code）保持 retryable=true', async () => {
    const db = makeContractDb();
    const result = await evaluateDiffGate({
      db, taskId: 't-stale', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'stale' }, affected_nodes: [], required_assertions: [],
        fact_revisions: { cecelia: 'base' },
      }),
    });
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('瞬态 revision_evidence_missing 保持 retryable=true', async () => {
    const db = makeContractDb({ baseRevision: 'base' });
    const result = await evaluateDiffGate({
      db, taskId: 't-evi', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'fresh' }, affected_nodes: [], required_assertions: [],
        fact_revisions: {},
      }),
    });
    expect(result.reason).toBe('revision_evidence_missing');
    expect(result.retryable).toBe(true);
  });

  test('freshness 携带具体终态 reason_code 时透传该 reason_code 且 retryable=false（不折叠成 mapper_stale）', async () => {
    const db = makeContractDb();
    const result = await evaluateDiffGate({
      db, taskId: 't-passthrough', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'projection_digest_mismatch' },
        affected_nodes: [], required_assertions: [], fact_revisions: { cecelia: 'base' },
      }),
    });
    expect(result.reason).toBe('projection_digest_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('未知/未枚举 reason_code 默认 fail-closed retryable=false 且透传原始 reason_code', async () => {
    const db = makeContractDb();
    const result = await evaluateDiffGate({
      db, taskId: 't-unknown', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => ({
        freshness: { status: 'stale', reason_code: 'brand_new_unenumerated_reason' },
        affected_nodes: [], required_assertions: [], fact_revisions: { cecelia: 'base' },
      }),
    });
    expect(result.reason).toBe('brand_new_unenumerated_reason');
    expect(result.retryable).toBe(false);
  });

});

describe('Structure Gate 同源折叠对齐（透传 + 分流）', () => {

  test('structure-gate 终态 revision_mismatch retryable=false（同源对齐）', async () => {
    const result = await evaluateStructureGate({
      db: null,
      task: { id: 't-struct', change_kind: 'bugfix' },
      contract: makeStructureContract(),
      mapClient: async () => ({
        manifest_digest: 'm', projection_digest: 'p',
        fact_revisions: { cecelia: 'zzz_does_not_match' },
        freshness: { status: 'fresh' }, affected_nodes: [], required_assertions: [],
      }),
    });
    expect(result.reason).toBe('revision_mismatch');
    expect(result.retryable).toBe(false);
  });

  test('structure-gate 瞬态 mapper_stale 保持 retryable=true', async () => {
    const result = await evaluateStructureGate({
      db: null,
      task: { id: 't-struct', change_kind: 'bugfix' },
      contract: makeStructureContract(),
      mapClient: async () => ({
        manifest_digest: 'm', projection_digest: 'p', fact_revisions: {},
        freshness: { status: 'stale' }, affected_nodes: [], required_assertions: [],
      }),
    });
    expect(result.reason).toBe('mapper_stale');
    expect(result.retryable).toBe(true);
  });

  test('structure-gate 瞬态 mapper_unavailable 保持 retryable=true', async () => {
    const result = await evaluateStructureGate({
      db: null,
      task: { id: 't-struct', change_kind: 'bugfix' },
      contract: makeStructureContract(),
      mapClient: async () => { const e = new Error('ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; },
    });
    expect(result.reason).toBe('mapper_unavailable');
    expect(result.retryable).toBe(true);
  });

});
