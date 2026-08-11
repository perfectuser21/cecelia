import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { digestMapManifest } from '../map-manifest-schema.js';
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
};
const runId = '67f4ffb8-a24d-4cce-b312-f057134910cc';

function successfulClient() {
  return {
    query: vi.fn(async (sql, params) => {
      if (/FROM fact_snapshot_headers/i.test(sql)) {
        return { rows: [
          { snapshot_kind: 'test', source_revision: 'b'.repeat(40) },
          { snapshot_kind: 'api', source_revision: 'a'.repeat(40) },
        ] };
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
    const result = await projectMapManifest({ client, manifestVersion });

    expect(result).toMatchObject({
      projection_run: { id: runId, status: 'active' },
      projection: {
        fact_revisions: { api: 'a'.repeat(40), test: 'b'.repeat(40) },
        nodes: expect.arrayContaining([expect.objectContaining({ node_type: 'value_stream' })]),
        edges: expect.arrayContaining([expect.objectContaining({ edge_type: 'hands_off_to' })]),
      },
    });
    const statements = client.query.mock.calls.map(([sql]) => sql);
    const index = (pattern) => statements.findIndex((sql) => pattern.test(sql));
    expect(index(/INSERT INTO map_projection_runs/i)).toBeLessThan(index(/INSERT INTO map_projection_nodes/i));
    expect(index(/INSERT INTO map_projection_nodes/i)).toBeLessThan(index(/INSERT INTO map_projection_edges/i));
    expect(index(/INSERT INTO map_projection_edges/i)).toBeLessThan(index(/status = 'superseded'/i));
    expect(index(/status = 'superseded'/i)).toBeLessThan(index(/status = 'active'/i));
    expect(statements.some((sql) => /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i.test(sql))).toBe(false);
  });

  it('批量实际写入数不完整时 fail closed，不切 active', async () => {
    const client = successfulClient();
    client.query.mockImplementation(async (sql, params) => {
      if (/FROM fact_snapshot_headers/i.test(sql)) return { rows: [] };
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
    expect(client.query.mock.calls.some(([sql]) => /status = 'active'/i.test(sql))).toBe(false);
  });
});
