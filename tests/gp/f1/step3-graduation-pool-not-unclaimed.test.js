// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：毕业机械步产物 ↔ impact gate unclaimed 判定
//
// r68 (run 7564804c) + r72 (run b448e642) 双实证：controller SKILL 2.7.0 的「毕业
// （测试入册）」机械步按设计把 sprints/<sprint>/tests/ 搬进 tests/regression/<slug>/
// （配 test-pyramid-guard 孤儿棘轮），但 map 半径的 unclaimed 判定不认识全局毕业池
// （tests/regression/ 与 scripts/smoke/e2e/ 没有 per-capability 锚）→ 毕业 commit 被
// diff gate 判 impact_anchor_missing（non-retryable）→ run 直接判死。
// 毕业步与 impact gate 自相矛盾：一边要求搬运，一边把搬运产物当越权杀 run。
//
// 修法（本批，最小不拆闸）：unclaimed 判定豁免毕业池目标前缀
// tests/regression/ 与 scripts/smoke/e2e/（设计内全局回归池，质量由
// test-pyramid-guard 棘轮与 CI 把守，不属能力半径职责）；其余未锚路径照拦
// （fail-closed 不扩大）。
//
// 真 import resolveImpactRadius（被改的边=unclaimed 纯判定逻辑）；db.query 为外部
// 依赖注入 stub（照 packages/brain/src/map/radius.test.js fixture 先例）。
import { describe, expect, it, vi } from 'vitest';
import { resolveImpactRadius } from '../../../packages/brain/src/map/radius.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TEST_REF = 'packages/brain/src/map/radius.test.js';

// 照 packages/brain/src/map/radius.test.js fixture 先例注入外部依赖（db/投影/清单），
// 被改的边（unclaimed 判定）真跑不 mock。
function fixture() {
  const query = vi.fn(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM graph_snapshot_versions AS snapshot')) {
      return { rows: [{
        snapshot_revision: BASE,
        src_path: TEST_REF, dst_path: 'packages/brain/src/routes/map.js', edge_type: 'import',
      }] };
    }
    if (text.includes('FROM journey_features')) {
      return { rows: [{
        id: 'feature-1', name: 'Radius', unit_test_path: TEST_REF,
        workflow_ref: null, guard_ref: null,
        capability_code: 'F1', capability_name: 'Factory',
      }] };
    }
    if (text.includes('FROM map_projection_nodes')) {
      return { rows: [{
        node_key: 'F1', name: 'Factory',
        attributes: { path_prefixes: ['packages/brain/'] },
      }] };
    }
    if (text.includes('FROM journey_step_links')) {
      return { rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        assertion_ref: TEST_REF, assertion_revision: 1, capability_code: 'F1',
      }] };
    }
    return { rows: [] };
  });
  return {
    db: { query },
    activeManifest: async () => ({ version: 1, digest: '1'.repeat(64) }),
    projectionForRevision: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
      fact_revisions: { cecelia: BASE }, status: 'active',
    }),
    manifestForProjection: async () => ({ version: 1, digest: '1'.repeat(64) }),
    factHealth: async () => ({ overall: 'fresh' }),
    repoScope: () => 'cecelia',
  };
}

describe('F1 step3 — 毕业池产物不计 unclaimed（r68/r72 案卷）', () => {
  it('tests/regression/ 与 scripts/smoke/e2e/ 下的毕业产物 → fresh 且 unclaimed 为空', async () => {
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: [
        'tests/regression/kernel-r72-commander-retry/gp/f1/step3-commander-infra-retry-bounded.test.js',
        'scripts/smoke/e2e/kernel-r72-commander-retry.sh',
        'packages/brain/src/orchestrator/derive.js',
      ],
      capability_ids: ['F1'],
    }, fixture());

    expect(result.freshness.status).toBe('fresh');
    expect(result.unclaimed_files).toEqual([]);
  });

  it('负向：其他未锚路径仍 fail-closed 判 impact_anchor_missing（豁免不扩大）', async () => {
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['unowned/new-module.js'], capability_ids: ['F1'],
    }, fixture());

    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'impact_anchor_missing',
    });
    expect(result.unclaimed_files).toEqual(['unowned/new-module.js']);
  });

  it('负向：前缀相似但不精确匹配毕业池的路径仍 unclaimed', async () => {
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['tests/regression-fake/x.test.js', 'scripts/smoke/e2e-fake/y.sh'],
      capability_ids: ['F1'],
    }, fixture());

    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'impact_anchor_missing',
    });
    expect(result.unclaimed_files).toEqual([
      'tests/regression-fake/x.test.js', 'scripts/smoke/e2e-fake/y.sh',
    ]);
  });
});
