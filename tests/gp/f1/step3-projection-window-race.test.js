// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：投影换代窗口 ↔ 确定性判死
//
// 2026-08-22 生产实证（r43 run 19759355 + r44 run d25d6fb5 同点双死）：
// fix 轮后 diff gate 撞投影换代窗口（rescan 每 ~10 分钟换代，换代瞬间
// capability 节点尚未物化完），capabilityNodes 返回空集 → owned=0 →
// 全部改动文件被误判 unclaimed → impact_anchor_missing 确定性杀 run；
// 事后 HTTP 复刻（带 digest）总是 fresh——典型瞬态被判成确定性。
// 修法①：radius 在 capability 节点集为空时报 projection_capabilities_empty
// （瞬态、可重试），绝不拿空集合去判 unclaimed；
// 修法②：gateReceipt 透传 unclaimed_files（#5015 修在 evaluateDiffGate 返回，
// 但 gateReceipt 白名单丢字段，r44 的 evidence 仍不可考古）。
import { describe, expect, it, vi } from 'vitest';
import { resolveImpactRadius } from '../../../packages/brain/src/map/radius.js';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { __test__ as harnessGatesTest } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const REV = 'a'.repeat(40);

function radiusDeps({ capabilityRows }) {
  const projection = {
    id: 'proj-1',
    status: 'active',
    scope_key: 'cecelia',
    manifest_version_id: 'mv-1',
    manifest_digest: 'digest-1',
    projection_digest: 'pd-1',
    fact_revisions: { cecelia: REV },
  };
  return {
    db: {
      query: vi.fn(async (sql) => {
        if (/graph_snapshot_versions/.test(sql)) {
          return { rows: [{ snapshot_revision: REV, src_path: null, dst_path: null, edge_type: null }] };
        }
        return { rows: [] };
      }),
    },
    projectionForRevision: async () => projection,
    manifestForProjection: async () => ({
      id: 'mv-1', version: 6, digest: 'digest-1', manifest: { capabilities: [] },
    }),
    factHealth: async () => ({ overall: 'fresh' }),
    repoScope: () => 'cecelia',
    capabilityNodes: async () => capabilityRows,
  };
}

describe('F1 step3：投影换代窗口不误判确定性（r43/r44 双死案卷）', () => {
  it('capability 节点集为空 → projection_capabilities_empty（瞬态），不判 anchor_missing', async () => {
    const result = await resolveImpactRadius({
      repo: 'cecelia',
      base_revision: REV,
      changed_files: ['packages/brain/src/x.js'],
      capability_ids: [],
    }, radiusDeps({ capabilityRows: [] }));
    expect(result.freshness.reason_code).toBe('projection_capabilities_empty');
    expect(result.freshness.reason_code).not.toBe('impact_anchor_missing');
  });

  it('diff-gate：projection_capabilities_empty 在瞬态白名单（retryable=true）', async () => {
    const gate = await evaluateDiffGate({
      db: null,
      taskId: 't-1',
      repo: 'cecelia',
      headRevision: 'b'.repeat(40),
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: async () => ({
        freshness: { status: 'unknown', reason_code: 'projection_capabilities_empty' },
      }),
    });
    expect(gate.reason_code).toBe('projection_capabilities_empty');
    expect(gate.retryable).toBe(true);
  });

  it('有 capability 节点时真 unclaimed 仍确定性判死（fail-closed 不回退）', async () => {
    const result = await resolveImpactRadius({
      repo: 'cecelia',
      base_revision: REV,
      changed_files: ['apps/unclaimed/file.js'],
      capability_ids: [],
    }, radiusDeps({
      capabilityRows: [{
        node_key: 'F1', name: '开发闭环',
        attributes: { path_prefixes: ['packages/brain/'], exact_paths: [] },
      }],
    }));
    expect(result.freshness.reason_code).toBe('impact_anchor_missing');
    expect(result.freshness.unclaimed_files).toEqual(['apps/unclaimed/file.js']);
  });

  it('gateReceipt 透传 unclaimed_files（evidence 可考古，r44 案卷）', () => {
    const receipt = harnessGatesTest.gateReceipt('diff', {
      gate: 'impact_unknown',
      reason: 'impact_anchor_missing',
      reason_code: 'impact_anchor_missing',
      retryable: false,
      unclaimed_files: ['apps/unclaimed/file.js'],
    });
    expect(receipt.unclaimed_files).toEqual(['apps/unclaimed/file.js']);
  });
});
