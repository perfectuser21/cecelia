import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveImpactRadius } from '../radius.js';

const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);

async function radius(changedFiles) {
  const manifest = JSON.parse(readFileSync(new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url)));
  return resolveImpactRadius({ repo: 'cecelia', base_revision: revision, changed_files: changedFiles }, {
    repoScope: () => 'cecelia',
    projectionForRevision: async () => ({ id: 'fixture', status: 'active', manifest_digest: digest,
      projection_digest: digest, fact_revisions: { cecelia: revision } }),
    manifestForProjection: async () => ({ version: 1, digest }),
    factHealth: async () => ({ overall: 'fresh' }),
    capabilityNodes: async () => manifest.capabilities.map(cap => ({
      node_key: cap.key, name: cap.name, attributes: cap,
    })),
    db: { query: async (sql) => {
      if (sql.includes('FROM graph_snapshot_versions')) return { rows: [{ snapshot_revision: revision }] };
      if (sql.includes('FROM activity_cells')) return { rows: ['F1', 'G1'].map((capability, index) => ({
        id: `11111111-1111-4111-8111-11111111111${index}`,
        assertion_ref: 'packages/brain/src/map/radius.test.js', assertion_revision: 1,
        capability_code: capability,
      })) };
      return { rows: [] };
    } },
  });
}

describe('交办台实现与验收文件的真实影响归属', () => {
  it('共享前端源文件和交办模块归G1，CI守卫归F1，不能因目录别名漏掉实际改动', async () => {
    const result = await radius([
      'apps/api/features/gtd/pages/GTDInbox.tsx',
      'apps/api/features/gtd/components/QuickCapture.tsx',
      'apps/api/features/workbench/task-desk/TaskDesk.tsx',
      'apps/api/features/workbench/task-desk/service.ts',
      'apps/api/features/navigation.ts',
      'apps/api/features/navigation.test.ts',
      'apps/api/features/shared/components/CeceliaChat.tsx',
      'apps/api/features/cecelia/pages/ConsciousnessChat.tsx',
      'apps/api/features/cecelia/components/CommandPalette.tsx',
      '.github/workflows/ci-dashboard-pwa-e2e.yml',
      '.gitignore',
    ]);
    expect(result.unclaimed_files).toEqual([]);
    expect(result.freshness.status).toBe('fresh');
    expect(result.affected_nodes.map(node => node.capability_id).sort()).toEqual(['F1', 'G1']);
  });

  it('补交办台归属不会顺带认领整个API服务端', async () => {
    const result = await radius(['apps/api/src/unowned-handler.ts']);
    expect(result.freshness).toMatchObject({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    expect(result.unclaimed_files).toEqual(['apps/api/src/unowned-handler.ts']);
  });
});
