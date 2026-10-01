/** 近七日事实视图读取；逐活动/工作流保留，禁止平均分位数。 */
const NUMBERS = ['runs', 'span_count', 'p50_duration_ms', 'p95_duration_ms', 'avg_wait_ms', 'fallback_rate', 'first_pass_yield', 'pass_rate', 'tokens_total', 'cost_usd_total'];
export async function loadActivityFlowMetrics(db, activityIds) {
  if (activityIds && !activityIds.length) return [];
  const { rows } = await db.query(
    `WITH RECURSIVE journey_ownership AS (
       SELECT j.id AS journey_id, j.id, j.parent_journey_id, j.capability_code, 0 AS depth FROM journeys j
       UNION ALL
       SELECT o.journey_id, j.id, j.parent_journey_id, j.capability_code, o.depth + 1
       FROM journey_ownership o JOIN journeys j ON j.id = o.parent_journey_id WHERE o.depth < 20
     ), ownership AS (
       SELECT w.id AS workflow_id, o.id, o.capability_code, o.depth
       FROM workflows w JOIN journey_ownership o ON o.journey_id = w.capability_id
     )
     SELECT m.*, a.name AS activity_name, w.name AS workflow_name,
       CASE WHEN m.workflow_id IS NULL THEN (
         SELECT o.capability_code FROM journey_ownership o WHERE o.journey_id = m.value_stream_id
           AND o.capability_code IS NOT NULL ORDER BY o.depth LIMIT 1)
       ELSE (SELECT o.capability_code FROM ownership o WHERE o.workflow_id = m.workflow_id
             AND o.capability_code IS NOT NULL ORDER BY o.depth LIMIT 1) END AS capability_code
     FROM activity_flow_metrics m
     JOIN journey_steps a ON a.id = m.activity_id JOIN journeys j ON j.id = m.value_stream_id
     LEFT JOIN workflows w ON w.id = m.workflow_id
     WHERE ($1::uuid[] IS NULL OR m.activity_id = ANY($1))
       AND (m.workflow_id IS NULL OR EXISTS (
         SELECT 1 FROM ownership o WHERE o.workflow_id = m.workflow_id AND o.id = m.value_stream_id
       ))
     ORDER BY m.activity_id, m.workflow_id NULLS FIRST`, [activityIds ?? null]);
  return rows.map(row => {
    const result = { ...row };
    for (const key of NUMBERS) if (key in result && result[key] != null) result[key] = Number(result[key]);
    return result;
  });
}
export async function attachActivityFlowMetrics(db, rows, { cells = false } = {}) {
  const idFor = row => cells ? (row.cell_level === 'activity' && row.cell_kind ? row.step_id : null) : row.id;
  const ids = [...new Set(rows.map(idFor).filter(Boolean))];
  const metrics = await loadActivityFlowMetrics(db, ids);
  const byActivity = new Map();
  for (const metric of metrics) {
    const bucket = byActivity.get(metric.activity_id) ?? [];
    bucket.push(metric); byActivity.set(metric.activity_id, bucket);
  }
  return rows.map(row => ({ ...row, flow_metrics: byActivity.get(idFor(row)) ?? [] }));
}
export function attachMapFlowMetrics(nodes, edges, metrics) {
  const byCapability = new Map();
  for (const metric of metrics) {
    const bucket = byCapability.get(metric.capability_code) ?? [];
    bucket.push(metric); byCapability.set(metric.capability_code, bucket);
  }
  const capabilities = new Map(nodes.filter(n => n.type === 'capability').map(n => [n.key, byCapability.get(n.key) ?? []]));
  return nodes.map(node => {
    if (node.type === 'capability') return { ...node, flow_metrics: capabilities.get(node.key) };
    if (node.type !== 'value_stream') return node;
    const items = edges.filter(e => e.from === node.key && ['contains', 'owns'].includes(e.type))
      .flatMap(e => capabilities.get(e.to) ?? []);
    const unique = new Map(items.map(m => [[m.activity_id, m.workflow_id ?? ''].join(':'), m]));
    return { ...node, flow_metrics: [...unique.values()] };
  });
}
