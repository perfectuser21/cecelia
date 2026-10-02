import { describe, it, expect, vi } from 'vitest';
import { loadActivityFlowMetrics, attachMapFlowMetrics } from '../activity-flow-metrics.js';

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
});
