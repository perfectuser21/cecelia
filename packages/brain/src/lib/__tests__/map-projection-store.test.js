import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { digestMapManifest } from '../map-manifest-schema.js';
import { stableMapEdgeId, stableMapNodeId } from '../map-projector.js';
import { projectMapManifest } from '../map-projection-store.js';

const manifest = JSON.parse(readFileSync(
  new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));
const manifestVersion = {
  id: '54b9ec3d-9ad5-4db0-99b3-7bbbeec34bf9',
  scope_key: manifest.scope_key,
  manifest,
  digest: digestMapManifest(manifest),
  status: 'active',
};
const runId = '67f4ffb8-a24d-4cce-b312-f057134910cc';

function successfulClient() {
  return {
    query: vi.fn(async (sql, params) => {
      if (/FROM map_manifest_versions[\s\S]*status = 'active'/i.test(sql)) {
        return { rows: [manifestVersion] };
      }
      if (/INSERT INTO map_projection_runs/i.test(sql)) return { rows: [{ id: runId }], rowCount: 1 };
      if (/INSERT INTO map_projection_nodes/i.test(sql)) {
        return { rows: [], rowCount: JSON.parse(params[1]).length };
      }
      if (/INSERT INTO map_projection_edges/i.test(sql)) {
        return { rows: [], rowCount: JSON.parse(params[1]).length };
      }
      if (/UPDATE map_projection_runs[\s\S]*status = 'active'/i.test(sql)) {
        return { rows: [{ id: runId, status: 'active' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('projectMapManifest', () => {
  it('以批量节点/边写入完整 run，最后才切 active', async () => {
    const client = successfulClient();
    const factRevisions = { repo_b: 'b'.repeat(40), repo_a: 'a'.repeat(40) };
    const result = await projectMapManifest({ client, manifestVersion, factRevisions });

    expect(result).toMatchObject({
      projection_run: { id: runId, status: 'active' },
      projection: {
        fact_revisions: { repo_a: 'a'.repeat(40), repo_b: 'b'.repeat(40) },
        nodes: expect.arrayContaining([expect.objectContaining({ node_type: 'value_stream' })]),
        edges: expect.arrayContaining([expect.objectContaining({ edge_type: 'hands_off_to' })]),
      },
    });
    const statements = client.query.mock.calls.map(([sql]) => sql);
    const index = (pattern) => statements.findIndex((sql) => pattern.test(sql));
    expect(index(/INSERT INTO map_projection_runs/i)).toBeLessThan(index(/INSERT INTO map_projection_nodes/i));
    expect(index(/INSERT INTO map_projection_nodes/i)).toBeLessThan(index(/INSERT INTO map_projection_edges/i));
    expect(index(/INSERT INTO map_projection_edges/i)).toBeLessThan(index(/status = 'superseded'/i));
    expect(index(/SET status = 'superseded'/i)).toBeLessThan(index(/SET status = 'active'/i));
    expect(statements.some((sql) => /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i.test(sql))).toBe(false);
    expect(statements.some((sql) => /fact_snapshot_headers/i.test(sql))).toBe(false);
    expect(client.query.mock.calls.filter(([sql]) => /pg_advisory_xact_lock/i.test(sql)))
      .toEqual([
        [expect.any(String), ['map-manifest:cecelia']],
        [expect.any(String), ['map-projection:cecelia']],
      ]);
  });

  it('批量实际写入数不完整时 fail closed，不切 active', async () => {
    const client = successfulClient();
    client.query.mockImplementation(async (sql, params) => {
      if (/FROM map_manifest_versions[\s\S]*status = 'active'/i.test(sql)) {
        return { rows: [manifestVersion] };
      }
      if (/INSERT INTO map_projection_runs/i.test(sql)) return { rows: [{ id: runId }], rowCount: 1 };
      if (/INSERT INTO map_projection_nodes/i.test(sql)) {
        return { rows: [], rowCount: JSON.parse(params[1]).length - 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(projectMapManifest({ client, manifestVersion })).rejects.toMatchObject({
      code: 'MAP_PROJECTION_WRITE_INCOMPLETE',
    });
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO map_projection_edges/i.test(sql))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => (
      /UPDATE map_projection_runs[\s\S]*SET status = 'active'/i.test(sql)
    ))).toBe(false);
  });

  it('重建只接受当前 active manifest，拒绝缓存中的旧版本', async () => {
    const client = successfulClient();
    client.query.mockImplementation(async (sql) => {
      if (/FROM map_manifest_versions[\s\S]*status = 'active'/i.test(sql)) {
        return { rows: [{ ...manifestVersion, id: '0372c30c-68c1-40da-bd1e-b7f9cf449e0e' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(projectMapManifest({ client, manifestVersion })).rejects.toMatchObject({
      code: 'MAP_PROJECTION_MANIFEST_STALE',
    });
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO map_projection_runs/i.test(sql)))
      .toBe(false);
  });

  it('同一事务加载 anchor projection，并把事实 revision 固定进 run', async () => {
    const client = successfulClient();
    const featureKey = '11111111-1111-4111-8111-111111111111';
    const featureNodeId = stableMapNodeId('cecelia', 'feature', featureKey);
    const capabilityNodeId = stableMapNodeId('cecelia', 'capability', 'F1');
    const loadAnchorProjection = vi.fn(async () => ({
      fact_revisions: { cecelia: 'a'.repeat(40) },
      nodes: [{
        node_id: featureNodeId,
        node_type: 'feature',
        node_key: featureKey,
        name: 'Exact feature',
        source_refs: [{ source: 'legacy-ledger', id: featureKey }],
        attributes: { capability_key: 'F1' },
      }],
      edges: [{
        edge_id: stableMapEdgeId('cecelia', 'implements', `${featureKey}:F1`),
        edge_type: 'implements',
        edge_key: `${featureKey}:F1`,
        from_node_id: featureNodeId,
        to_node_id: capabilityNodeId,
        source_refs: [{ source: 'legacy-ledger', id: featureKey }],
        attributes: {},
      }],
      issues: [],
    }));

    const result = await projectMapManifest({
      client,
      manifestVersion,
      loadAnchorProjection,
    });

    expect(loadAnchorProjection).toHaveBeenCalledWith(client, {
      scopeKey: 'cecelia',
      capabilityKeys: manifest.capabilities.map(({ key }) => key),
    });
    expect(result.projection.fact_revisions).toEqual({ cecelia: 'a'.repeat(40) });
    expect(result.projection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_type: 'feature', node_key: featureKey }),
    ]));
  });
});
