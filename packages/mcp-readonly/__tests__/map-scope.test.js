import { expect, it, vi } from 'vitest';
import { getMapSummary } from '../src/tools/map-summary.js';
it('显式scope限定manifest且run绑定同一manifest版本及digest', async () => {
  const query = vi.fn(async (_pool, sql, params) => {
    if (sql.includes('FROM map_projection_nodes')) return { rows: [{ node_type: 'capability', count: '2' }] };
    return { rows: [{ active_manifest_id: 'manifest-a', active_run_id: 'run-a', projection_status: 'active' }] };
  });
  const result = await getMapSummary({}, query, { scope: 'company-a' });
  expect(query.mock.calls[0][1]).toMatch(/m\.scope_key\s*=\s*\$1/);
  expect(query.mock.calls[0][1]).toMatch(/r\.manifest_version_id\s*=\s*m\.id/);
  expect(query.mock.calls[0][1]).toMatch(/r\.manifest_digest\s*=\s*m\.digest/);
  expect(query.mock.calls[0][2]).toEqual(['company-a']);
  expect(result).toMatchObject({ scope_key: 'company-a', active_manifest_id: 'manifest-a', active_run_id: 'run-a', node_counts: { capability: 2 } });
  expect(query.mock.calls[1][2]).toEqual(['run-a']);
});
it('缺scope拒绝，active manifest没有匹配run时不读历史节点', async () => {
  const query = vi.fn(async () => ({ rows: [{ active_manifest_id: 'manifest-new', active_run_id: null, projection_status: null }] }));
  await expect(getMapSummary({}, query)).rejects.toThrow('scope');
  expect(query).not.toHaveBeenCalled();
  expect(await getMapSummary({}, query, { scope: 'company-a' })).toMatchObject({ no_active_run: true, node_counts: {}, active_run_id: null });
  expect(query).toHaveBeenCalledOnce();
});
