import { describe, it, expect } from 'vitest';

// 真 gate + 真 classifier —— 禁 mock 被改的边（见 contract-draft.md 禁 mock 边清单）
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';
// 本 sprint 新增模块（Generator 交付前 import 失败 → TDD Red）
import {
  classifyMapperStale,
  DETERMINISTIC_STALE_REASON_CODES,
} from '../../../packages/brain/src/impact-contract/mapper-stale.js';
// 本 sprint 从 loop.js 消费路径抽出的纯分类器（Generator 交付前 import 失败 → TDD Red）
import { classifyImpactBlockFailureClass } from '../../../packages/brain/src/orchestrator/impact-block-classify.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HEAD = 'b'.repeat(40);
const CHANGED = ['packages/brain/src/impact-contract/diff-gate.js'];

// Map HTTP 边界替身：Map 自身不在本单范围（PRD「不改 Map 契约」），注入确定性 freshness 输入
function mapClientWith(freshness) {
  return async ({ repo, baseRevision }) => ({
    manifest_digest: 'stub_manifest',
    projection_digest: 'stub_projection',
    fact_revisions: { [repo || 'cecelia']: baseRevision || 'stub_rev' },
    freshness,
    affected_nodes: [],
    required_assertions: [],
  });
}

const BASE_TASK = { id: TASK_ID, change_kind: 'bugfix' };
const BASE_CONTRACT = {
  task_id: TASK_ID,
  change_kind: 'bugfix',
  repo: 'cecelia',
  base_revision: 'a'.repeat(40),
  head_revision: HEAD,
  affected_capabilities: [{ capability_id: 'F1' }],
  required_assertions: [],
  contract_body: { affected_capabilities: [{ capability_id: 'F1' }], required_assertions: [] },
};

function diffGateStale(freshness) {
  return evaluateDiffGate({
    taskId: TASK_ID,
    repo: 'cecelia',
    headRevision: HEAD,
    changedFiles: CHANGED,
    mapClient: mapClientWith(freshness),
  });
}

function structureGateStale(freshness) {
  return evaluateStructureGate({
    db: null,
    task: BASE_TASK,
    contract: BASE_CONTRACT,
    mapClient: mapClientWith(freshness),
  });
}

describe('mapper_stale reason_code 透传 + 确定性 fail-closed [BEHAVIOR]', () => {
  it('B-01 deterministic stale diff-gate fail-closed 携带真实 reason_code', async () => {
    const r = await diffGateStale({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(r.gate).toBe('impact_unknown');           // 非 fresh 仍不放行
    expect(r.reason).toBe('projection_revision_mismatch'); // 不再折叠成裸 mapper_stale
    expect(r.reason_code).toBe('projection_revision_mismatch');
    expect(r.retryable).toBe(false);                 // 确定性 → fail-closed 终态
  });

  it('B-02 transient stale diff-gate retryable（ttl / 缺失 / unknown 三态）', async () => {
    const ttl = await diffGateStale({ status: 'stale', reason_code: 'ttl_exceeded' });
    expect(ttl.retryable).toBe(true);                // 瞬时保留重试
    expect(ttl.reason).toBe('ttl_exceeded');         // 仍携带真实 reason_code

    const missing = await diffGateStale({ status: 'stale', reason_code: null });
    expect(missing.retryable).toBe(true);            // 缺 reason_code 保守瞬时
    expect(missing.reason).toBe('mapper_stale');     // 无码才回落裸 mapper_stale
    expect(missing.reason_code).toBe(null);

    const unknown = await diffGateStale({ status: 'unknown', reason_code: 'projection_revision_mismatch' });
    expect(unknown.retryable).toBe(true);            // unknown 视为瞬时，即便码命中白名单
  });

  it('B-03 structure-gate 同款折叠一致化（与 diff-gate 行为不分叉）', async () => {
    const det = await structureGateStale({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(det.gate).toBe('blocked');
    expect(det.reason).toBe('projection_revision_mismatch');
    expect(det.reason_code).toBe('projection_revision_mismatch');
    expect(det.retryable).toBe(false);

    const trans = await structureGateStale({ status: 'stale', reason_code: 'ttl_exceeded' });
    expect(trans.reason).toBe('ttl_exceeded');
    expect(trans.retryable).toBe(true);

    // classifyMapperStale 是两 Gate 共享的判定源，三字段一致
    const shared = classifyMapperStale({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(shared).toMatchObject({
      reason: 'projection_revision_mismatch',
      reason_code: 'projection_revision_mismatch',
      retryable: false,
    });
  });

  it('B-04 loop classify: 真 gate receipt 直接喂真 classifier', async () => {
    const det = await diffGateStale({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(classifyImpactBlockFailureClass(det)).toBe('impact_contract_invalid'); // BLOCKED 终态收口

    const trans = await diffGateStale({ status: 'stale', reason_code: 'ttl_exceeded' });
    expect(classifyImpactBlockFailureClass(trans)).toBe('infrastructure_blocked'); // 瞬时仍 backoff 重试

    // deny:impact:<reason_code> 携带真实码（不再裸 mapper_stale 掩盖终态原因）
    expect(`deny:impact:${det.reason}`).toBe('deny:impact:projection_revision_mismatch');

    // 既有分支不回退：drift / gap_dependencies 仍归 gap_dependencies
    expect(classifyImpactBlockFailureClass({ reason: 'CONTRACT_IMPACT_DRIFT', retryable: false }))
      .toBe('gap_dependencies');
  });

  it('B-05 regression f62c7e87/d1360a48: 真 radius.js 确定性码不再无限空转', async () => {
    for (const code of ['projection_revision_mismatch', 'manifest_projection_mismatch']) {
      expect(DETERMINISTIC_STALE_REASON_CODES.has(code)).toBe(true);
      const r = await diffGateStale({ status: 'stale', reason_code: code });
      expect(r.reason).not.toBe('mapper_stale');     // 裸码被消除
      expect(r.retryable).toBe(false);               // 一次性 fail-closed
      expect(classifyImpactBlockFailureClass(r)).toBe('impact_contract_invalid'); // 不重派
    }
    // 瞬时码不误伤（双保险）：fact_snapshot_stale 仍可重试
    const t = await diffGateStale({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(t.retryable).toBe(true);
    expect(classifyImpactBlockFailureClass(t)).toBe('infrastructure_blocked');
  });
});
