/** 真PostgreSQL语义回归，只有CTE与SELECT，无schema或数据写入。 */
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { loadActivityFlowMetrics } from '../../lib/activity-flow-metrics.js';
if (!/_(test|scratch)$/.test(DB_DEFAULTS.database ?? '')) throw Error('活动归属回归仅限测试库');
const pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
afterAll(() => pool.end());
const fixtures = `WITH RECURSIVE fixture_journeys(id,parent_journey_id,capability_code) AS (VALUES
 ('aaaaaaaa-0000-4000-8000-000000000001'::uuid,NULL::uuid,'F0'),
 ('aaaaaaaa-0000-4000-8000-000000000002'::uuid,NULL::uuid,'G1'),
 ('aaaaaaaa-0000-4000-8000-000000000003'::uuid,'aaaaaaaa-0000-4000-8000-000000000001'::uuid,NULL::text)),
 fixture_workflows(id,capability_id,name) AS (VALUES
 ('bbbbbbbb-0000-4000-8000-000000000001'::uuid,'aaaaaaaa-0000-4000-8000-000000000003'::uuid,'流程')),
 fixture_steps(id,name,capability_key) AS (VALUES
 ('cccccccc-0000-4000-8000-000000000001'::uuid,'无工作流错标签','G1'),
 ('cccccccc-0000-4000-8000-000000000002'::uuid,'有效父链','G1'),
 ('cccccccc-0000-4000-8000-000000000003'::uuid,'跨流工作流','G1')),
 fixture_metrics(activity_id,value_stream_id,workflow_id,p50_duration_ms) AS (VALUES
 ('cccccccc-0000-4000-8000-000000000001'::uuid,'aaaaaaaa-0000-4000-8000-000000000001'::uuid,NULL::uuid,0),
 ('cccccccc-0000-4000-8000-000000000002'::uuid,'aaaaaaaa-0000-4000-8000-000000000001'::uuid,'bbbbbbbb-0000-4000-8000-000000000001'::uuid,1),
 ('cccccccc-0000-4000-8000-000000000003'::uuid,'aaaaaaaa-0000-4000-8000-000000000002'::uuid,'bbbbbbbb-0000-4000-8000-000000000001'::uuid,2)), `;
describe('活动指标真实SQL归属', () => {
  it('NULL workflow的自由key不跨流；合法父链保留，跨流workflow拒绝', async () => {
    let sql;
    await loadActivityFlowMetrics({ query: async q => { sql = q; return { rows: [] }; } });
    sql = sql.replaceAll('FROM journeys j', 'FROM fixture_journeys j').replaceAll('JOIN journeys j', 'JOIN fixture_journeys j')
      .replaceAll('FROM workflows w', 'FROM fixture_workflows w').replaceAll('JOIN workflows w', 'JOIN fixture_workflows w')
      .replaceAll('FROM activity_flow_metrics m', 'FROM fixture_metrics m').replaceAll('JOIN journey_steps a', 'JOIN fixture_steps a');
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const { rows } = await client.query(fixtures + sql.replace('WITH RECURSIVE ', ''), [null]);
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.capability_code === 'F0')).toBe(true);
      expect(rows.map(row => row.activity_name)).toEqual(['无工作流错标签', '有效父链']);
      expect(rows[0].p50_duration_ms).toBe(0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
});
