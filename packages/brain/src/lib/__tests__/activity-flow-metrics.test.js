import { describe, it, expect, vi } from 'vitest';
import { loadActivityFlowMetrics, attachMapFlowMetrics } from '../activity-flow-metrics.js';
import { selectStepLinksForProjection } from '../notion-activity-flow.js';
import { pushRegisteredRows, propsDigest } from '../notion-projection-engine.js';
import { buildStepLinkNotionProperties } from '../../notion-probe-projection.js';

describe('活动事实指标边界', () => {
  it('当前 scope 精确代码和归属边，逐 workflow 去重；无拓扑不补挂', () => {
    const nodes = [{ key: 'line', type: 'value_stream' }, { key: 'C', type: 'capability' }, { key: 'other', type: 'value_stream' }, { key: 'S', type: 'step' }];
    const metrics = [
      { activity_id: 'a', workflow_id: 'w1', capability_code: 'C', p50_duration_ms: 0 },
      { activity_id: 'a', workflow_id: 'w2', capability_code: 'C', p50_duration_ms: 100 },
      { activity_id: 'foreign', workflow_id: 'w3', capability_code: 'OUTSIDE' },
    ];
    const edges = [{ from: 'line', to: 'C', type: 'contains' }, { from: 'line', to: 'C', type: 'owns' }, { from: 'other', to: 'C', type: 'hands_off_to' }];
    const result = attachMapFlowMetrics(nodes, edges, metrics);
    expect(result[0].flow_metrics).toEqual(metrics.slice(0, 2));
    expect(result[1].flow_metrics).toEqual(metrics.slice(0, 2));
    expect(result[2].flow_metrics).toEqual([]);
    expect(result[3].flow_metrics).toBeUndefined();
    expect(result).toHaveLength(nodes.length);
  });
  it('视图读取保留零值与 null，SQL 核工作流父链归属', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ activity_id: 'a', span_count: '2', cost_usd_total: null, p50_duration_ms: 0 }] })) };
    expect(await loadActivityFlowMetrics(db, ['a'])).toEqual([{ activity_id: 'a', span_count: 2, cost_usd_total: null, p50_duration_ms: 0 }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('w.capability_id');
    expect(sql).toContain('o.id = m.value_stream_id');
    expect(params).toEqual([['a']]);
  });
  it('61 活动持续 dirty 与推送失败，保留 25 sweep、游标推进回绕且不伪造 synced', async () => {
    const activities = Array.from({ length: 61 }, (_, i) => ({ id: String(i + 1).padStart(3, '0'), step_id: 'a', cell_level: 'activity', cell_kind: 'element', notion_id: 'p' + i, journey_name: '路径' }));
    let cursor = null;
    const queries = [];
    const db = { query: vi.fn(async (sql, params) => {
      const text = String(sql); queries.push([text, params]);
      if (text.startsWith('SELECT value_json')) return { rows: cursor ? [{ value_json: { id: cursor } }] : [] };
      if (text.includes('/* activity_flow_sweep */')) {
        const sorted = [...activities.filter(a => !params[0] || a.id > params[0]), ...activities.filter(a => params[0] && a.id <= params[0])];
        return { rows: sorted.slice(0, 25) };
      }
      if (text.startsWith('INSERT INTO working_memory')) { cursor = JSON.parse(params[0]).id; return { rows: [] }; }
      if (text.includes('FROM journey_step_links l')) return { rows: Array.from({ length: 25 }, (_, i) => ({ id: 'dirty' + i, step_id: 'a', cell_level: 'activity', cell_kind: 'element', notion_id: 'pd' + i })) };
      return { rows: [] };
    }) };
    const visited = new Set();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let round = 0; round < 3; round++) {
      const rows = await selectStepLinksForProjection(db);
      expect(rows).toHaveLength(50);
      rows.filter(a => !a.id.startsWith('dirty')).forEach(a => visited.add(a.id));
      await pushRegisteredRows(db, 'fake', { table: 'journey_step_links', dbId: 'fake', rows, buildProps: buildStepLinkNotionProperties, notionReq: async () => { throw new Error('503 outage'); } });
    }
    expect(visited.size).toBe(61);
    expect(queries.filter(([sql]) => sql.includes('notion_synced_at = NOW()'))).toHaveLength(0);
    expect(queries.filter(([sql]) => sql.includes('INSERT INTO working_memory'))).toHaveLength(3);
    vi.restoreAllMocks();
  });
  it('span 改变 PATCH，指标未变只计账，七日过期发 number:null 清旧', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) }; const req = vi.fn(async () => ({}));
    const row = { id: 'a', notion_id: 'page', journey_name: '路径', cell_level: 'activity', cell_kind: 'element', flow_metrics: [{ workflow_id: 'w', p50_duration_ms: 5, first_pass_yield: 1, pass_rate: 0, span_count: 1 }] };
    const run = rows => pushRegisteredRows(db, 'fake', { table: 'journey_step_links', dbId: 'fake', rows, buildProps: buildStepLinkNotionProperties, notionReq: req });
    row.notion_digest = propsDigest(buildStepLinkNotionProperties(row));
    expect((await run([row])).skipped).toBe(1); expect(req).not.toHaveBeenCalled();
    expect((await run([{ ...row, flow_metrics: [{ ...row.flow_metrics[0], span_count: 2 }] }])).patched).toBe(1);
    await run([{ ...row, flow_metrics: [] }]);
    expect(req.mock.calls.at(-1)[3].properties.FlowP50Ms).toEqual({ number: null });
    expect(req.mock.calls.at(-1)[3].properties.FlowMetrics).toEqual({ rich_text: [] });
  });
});
