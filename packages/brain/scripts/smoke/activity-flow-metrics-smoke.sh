#!/usr/bin/env bash
# 903e9956：真实PG只读加载+候选API字段，永久消费者回归；不采收、不写Notion。
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import pg from 'pg';
import { DB_DEFAULTS } from './src/db-config.js';
import { loadActivityFlowMetrics } from './src/lib/activity-flow-metrics.js';
const pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const metrics = await loadActivityFlowMetrics(client);
  for (const metric of metrics) assert.equal(typeof metric.span_count, 'number');
  console.log('真实七日视图读取行数=' + metrics.length);
} finally {
  await client.query('ROLLBACK'); client.release(); await pool.end();
}
const base = process.env.BRAIN_URL || 'http://localhost:5221';
for (const path of ['journey_steps?limit=500', 'journey_step_links?cells=1&limit=500', 'journey_step_links?limit=500']) {
  const response = await fetch(base + '/api/brain/' + path, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.ok, true, '候选API HTTP ' + response.status);
  const rows = await response.json();
  assert.ok(Array.isArray(rows));
  for (const row of rows) {
    assert.ok(Array.isArray(row.flow_metrics), 'flow_metrics字段缺失');
    if (path.startsWith('journey_step_links') && (row.cell_level !== 'activity' || !row.cell_kind)) assert.deepEqual(row.flow_metrics, []);
  }
  console.log('真实API ' + path + ' 行数=' + rows.length);
}
NODE
npx vitest run src/routes/__tests__/journeys.test.js src/__tests__/notion-probe-projection.test.js src/lib/__tests__/activity-flow-metrics.test.js src/lib/__tests__/notion-activity-flow.test.js
