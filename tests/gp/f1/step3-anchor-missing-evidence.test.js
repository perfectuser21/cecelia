// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：确定性判死 ↔ 可考古证据
//
// 2026-08-22 生产实证（r43 run 19759355 hop38）：run 被
// deny:impact:impact_anchor_missing 确定性判死（fail-closed 不重试），但 gate
// evidence 不含哪个文件 unclaimed；事后同输入复现 unclaimed=[]（瞬态时序，现场
// 已不可回放）——失败不留原因病：不可考古的确定性判死禁止存在。
// 修法：radius 的 freshness 带 unclaimed_files 诊断字段；diff-gate 3a 透传进
// 返回值（kernel 把 gate 结果整体落 decision_log evidence，即可考古）。
import { describe, expect, it, vi } from 'vitest';
import { resolveImpactRadius } from '../../../packages/brain/src/map/radius.js';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const REV = 'a'.repeat(40);

function radiusDeps() {
  const projection = {
    id: 'proj-1',
    status: 'active',
    scope_key: 'cecelia',
    manifest_version_id: 'mv-1',
    manifest_digest: 'digest-1',
    projection_digest: 'pd-1',
    source_revisions: { cecelia: REV },
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
    capabilityNodes: async () => [{
      node_key: 'F1',
      name: '开发闭环',
      attributes: { path_prefixes: ['packages/brain/'], exact_paths: [] },
    }],
  };
}

describe('F1 step3：impact_anchor_missing 留痕 unclaimed 文件清单（r43 案卷）', () => {
  it('radius：unclaimed 文件触发 impact_anchor_missing 时 freshness 带 unclaimed_files', async () => {
    const result = await resolveImpactRadius({
      repo: 'cecelia',
      base_revision: REV,
      changed_files: ['apps/unclaimed/file.js', 'packages/brain/src/x.js'],
      capability_ids: ['F1'],
    }, radiusDeps());
    expect(result.freshness.reason_code).toBe('impact_anchor_missing');
    expect(result.freshness.unclaimed_files).toEqual(['apps/unclaimed/file.js']);
  });

  it('radius：全部被 claim 时不带 unclaimed_files（正常路径无噪音）', async () => {
    const result = await resolveImpactRadius({
      repo: 'cecelia',
      base_revision: REV,
      changed_files: ['packages/brain/src/x.js'],
      capability_ids: ['F1'],
    }, radiusDeps());
    expect(result.freshness.reason_code).not.toBe('impact_anchor_missing');
    expect(result.freshness.unclaimed_files).toBeUndefined();
  });

  it('diff-gate 3a：unclaimed_files 透传进 gate 返回（kernel evidence 可考古）', async () => {
    const gate = await evaluateDiffGate({
      db: { query: vi.fn(async () => ({ rows: [] })) },
      taskId: 't-1',
      repo: 'cecelia',
      headRevision: 'b'.repeat(40),
      changedFiles: ['apps/unclaimed/file.js'],
      contract: { base_revision: REV, repo: 'cecelia', contract_hash: 'h' },
      mapClient: async () => ({
        freshness: {
          status: 'unknown',
          reason_code: 'impact_anchor_missing',
          unclaimed_files: ['apps/unclaimed/file.js'],
        },
      }),
    });
    expect(gate.reason_code).toBe('impact_anchor_missing');
    expect(gate.retryable).toBe(false);
    expect(gate.unclaimed_files).toEqual(['apps/unclaimed/file.js']);
  });
});
