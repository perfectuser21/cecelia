import { describe, it, expect } from 'vitest';
import { attachActivityFlowMetrics, attachMapFlowMetrics } from '../../../packages/brain/src/lib/activity-flow-metrics.js';
import { buildNotionFlowProperties } from '../../../packages/brain/src/lib/notion-activity-flow.js';

describe('903e9956冻结指标合同', () => {
  const metrics = [
    {activity_id:'a', workflow_id:'w1', capability_code:'C', p50_duration_ms:0, first_pass_yield:0, span_count:2},
    {activity_id:'a', workflow_id:'w2', capability_code:'C', p50_duration_ms:900, first_pass_yield:1, span_count:3},
  ];
  it('活动多工作流独立且非活动格不继承', async () => {
    const db={query:async()=>({rows:metrics})};
    const rows=[{id:'ca',step_id:'a',cell_level:'activity',cell_kind:'element',cell_status:'red'},
      {id:'cs',step_id:'a',cell_level:'step',cell_kind:'element'},
      {id:'old',step_id:'a',cell_level:'activity',cell_kind:null}];
    const result=await attachActivityFlowMetrics(db,rows,{cells:true});
    expect(result).toHaveLength(3);expect(result[0].flow_metrics).toEqual(metrics);
    expect(result[0].cell_status).toBe('red');expect(result[1].flow_metrics).toEqual([]);expect(result[2].flow_metrics).toEqual([]);
  });
  it('当前地图归属隔离不补拓扑且不平均分位数',()=>{
    const nodes=[{key:'line',type:'value_stream'},{key:'C',type:'capability'}];
    const result=attachMapFlowMetrics(nodes,[{from:'line',to:'C',type:'contains'}],[...metrics,{activity_id:'foreign',capability_code:'X'}]);
    expect(result).toHaveLength(2);expect(result[0].flow_metrics).toEqual(metrics);expect(result[1].flow_metrics).toEqual(metrics);
  });
  it('Notion零值保留窗口过期清空多工作流不任选',()=>{
    const row={cell_level:'activity',cell_kind:'element',flow_metrics:[metrics[0]]};
    expect(buildNotionFlowProperties(row).FlowP50Ms).toEqual({number:0});
    expect(buildNotionFlowProperties({...row,flow_metrics:[]}).FlowP50Ms).toEqual({number:null});
    expect(buildNotionFlowProperties({...row,flow_metrics:metrics}).FlowP50Ms).toEqual({number:null});
    expect(buildNotionFlowProperties({...row,flow_metrics:metrics}).FlowMetrics.rich_text.map(r=>r.text.content).join('')).toContain('w2');
  });
});
