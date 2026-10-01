# 冻结合同：903e9956 活动过程指标

## 范围与不变量
- packages/brain/src/lib/activity-flow-metrics.js
- packages/brain/src/lib/notion-activity-flow.js
- packages/brain/src/lib/map-read-service.js
- packages/brain/src/routes/journeys.js
- packages/brain/src/notion-push-sync.js
- packages/brain/src/notion-probe-projection.js
- packages/brain/src/ops-notion-schema.js
- apps/api/features/planning/components/ActivityFlowMetrics.tsx
- apps/api/features/planning/pages/MapPage.tsx
- apps/dashboard/src/pages/strategist/StrategistLinePage.tsx

允许对应永久回归、smoke白名单与已有版本五件套/DEFINITION/DoD同步。无schema/网络/采收改动。指标按activity+workflow独立数组；严禁平均p50或任选workflow。归属依journey/workflow真实父链与当前scope边，不按活动名或自由key兜底。仅cell_kind非空的activity格接线；step/enabler/legacy为空。增量dirty25+sweep25持久id游标先推进，失败不伪造synced。Notion活动无数据明确number:null；非活动/旧连接不追加Flow。新增Flow列以真实schema响应确认存在且类型一致；schema读取、补列、响应结构或类型校验失败均停本轮格子推送，保留正确页面绑定与指纹，不进入错库解绑。指纹不变不PATCH。地图主响应直接显示，radius故障不挡过程指标。一次做对显示未使用兜底口径与独立通过率。

## Test Contract
| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
| --- | --- | --- | --- |
| 冻结指标事实 | sprints/tests/activity-flow-metrics.test.js | 活动多工作流独立且非活动格不继承、当前地图归属隔离不补拓扑且不平均分位数、Notion零值保留窗口过期清空多工作流不任选 | 先行永久红commit4a8a5a260b等 |
| 既有 API | packages/brain/src/routes/__tests__/journeys.test.js | journey_steps 保留同一活动的两个工作流，未观测活动为空 | flow_metrics原为undefined |
| 持续更新 | packages/brain/src/lib/__tests__/notion-activity-flow.test.js | 61 活动持续 dirty 与推送失败，保留 25 sweep、游标推进回绕且不伪造 synced | span-only原不推 |

## 机械验证

运行根 npx vitest run sprints/tests/activity-flow-metrics.test.js，运行packages/brain对应永久回归与完整suite、apps/dashboard完整332条测试及build。正式原生evaluator与Judge必须在当前PR head锚定，真实CI全绿后正常merge；禁止伪造run events或把独审冒充原生验收。

## E2E 验收

```bash
set -euo pipefail
node --input-type=module <<'FLOW_E2E'
import assert from 'node:assert/strict';
const base = process.env.FLOW_METRICS_BASE_URL || 'http://localhost:5221';
const token = process.env.CECELIA_INTERNAL_TOKEN;
const get = async path => {
  const res = await fetch(base + '/api/brain/' + path, {
    headers: token ? {'X-Internal-Token': token} : {},
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(res.ok, true, '真实 API HTTP ' + res.status + ': ' + path);
  return res.json();
};
const steps = await get('journey_steps?limit=500');
const cells = await get('journey_step_links?cells=1&limit=500');
const legacy = await get('journey_step_links?limit=500');
const map = await get('map?scope=zenithjoy');
const key = m => m.activity_id + ':' + (m.workflow_id ?? '');
const facts = new Map();
for (const step of steps) {
  assert.ok(Array.isArray(step.flow_metrics), '活动指标字段缺失');
  for (const metric of step.flow_metrics) {
    assert.equal(metric.activity_id, step.id);
    assert.equal(typeof metric.span_count, 'number');
    for (const field of ['p50_duration_ms', 'first_pass_yield', 'pass_rate']) {
      assert.ok(metric[field] === null || typeof metric[field] === 'number');
    }
    facts.set(key(metric), metric);
  }
}
assert.ok(facts.size > 0, '没有真实七日活动观测，不能报验收通过');
for (const cell of [...cells, ...legacy]) {
  assert.ok(Array.isArray(cell.flow_metrics));
  if (cell.cell_level !== 'activity' || !cell.cell_kind) assert.deepEqual(cell.flow_metrics, []);
  for (const metric of cell.flow_metrics) assert.deepEqual(metric, facts.get(key(metric)));
}
const capabilities = map.nodes.filter(n => n.type === 'capability');
for (const node of capabilities) {
  assert.ok(Array.isArray(node.flow_metrics), '地图指标字段缺失');
  for (const metric of node.flow_metrics) {
    assert.equal(metric.capability_code, node.key);
    assert.deepEqual(metric, facts.get(key(metric)));
  }
}
assert.ok(capabilities.some(n => n.flow_metrics.length > 0), '地图没有读到真实活动观测');
for (const node of map.nodes.filter(n => n.type === 'value_stream')) {
  const expected = new Map(map.edges.filter(e => e.from === node.key && ['contains', 'owns'].includes(e.type))
    .flatMap(e => capabilities.find(n => n.key === e.to)?.flow_metrics ?? []).map(m => [key(m), m]));
  assert.deepEqual(new Map(node.flow_metrics.map(m => [key(m), m])), expected);
}
console.log(JSON.stringify({actor: 'native-flow-metrics-e2e', utc: new Date().toISOString(), observed_pairs: facts.size, cells: cells.length, map_scope: map.scope_key}));
FLOW_E2E
```

此可执行场景验证真实候选 API 的逐工作流接线；页面与Notion生产回读是合并部署后的必需交付证据，不以该 API 场景替代。
生产 GET journey_steps/journey_step_links/map 与activity_flow_metrics真身一致；collection历史19spans p50=908000ms first_pass_yield1 pass_rate约0.1579只是旧批基线。等待既有Notion同步链产生Flow属性后读回目标page，记录来源与时间。原d4新夜批保持blocked至指定窗口。

真实页面证据：部署后访问地图并选择zenithjoy-workspace，截图/DOM显示采集p50与一次做对/通过率/样本；军师客户智能获客路径活动行同指标；生产API逐activity/workflow读回与视图比较。Notion通过既有同步tick写入，读回activity目标page的FlowP50Ms/FlowFirstPassYield/FlowPassRate/FlowSpanCount；原cell_status仍来自回执。所有证据带actual UTC与actor，数据没有即记录无数据，不造新采收/回放。
