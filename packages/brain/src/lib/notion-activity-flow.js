import { attachActivityFlowMetrics } from './activity-flow-metrics.js';
/** 独立预留25个活动复核名额；游标先于外部推送持久推进，失败不伪造synced。 */
export async function selectStepLinksForProjection(db) {
  const { rows: dirty } = await db.query(`SELECT l.*, j.name AS journey_name, s.name AS step_name
    FROM journey_step_links l JOIN journeys j ON j.id = l.journey_id LEFT JOIN journey_steps s ON s.id = l.step_id
    WHERE l.notion_synced_at IS NULL OR l.updated_at > l.notion_synced_at
    ORDER BY l.updated_at, l.id LIMIT 25`);
  const { rows: saved } = await db.query("SELECT value_json FROM working_memory WHERE key = 'activity_flow_sweep_cursor'");
  const cursor = saved[0]?.value_json?.id ?? null;
  const { rows: sweep } = await db.query(`/* activity_flow_sweep */
    SELECT l.*, j.name AS journey_name, s.name AS step_name
    FROM journey_step_links l JOIN journeys j ON j.id = l.journey_id LEFT JOIN journey_steps s ON s.id = l.step_id
    WHERE l.cell_level = 'activity' AND l.cell_kind IS NOT NULL
    ORDER BY CASE WHEN $1::uuid IS NULL OR l.id > $1 THEN 0 ELSE 1 END, l.id LIMIT 25`, [cursor]);
  if (sweep.length) await db.query(`INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ('activity_flow_sweep_cursor', $1::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`, [JSON.stringify({ id: sweep.at(-1).id })]);
  const rows = [...new Map([...dirty, ...sweep].map(row => [row.id, row])).values()];
  return attachActivityFlowMetrics(db, rows, { cells: true });
}
export function buildNotionFlowProperties(row) {
  const metrics = row.cell_level === 'activity' && row.cell_kind ? (row.flow_metrics ?? []) : [];
  const single = metrics.length === 1 ? metrics[0] : null;
  const number = key => ({ number: single?.[key] == null ? null : Number(single[key]) });
  const text = metrics.map(m => JSON.stringify({ workflow_id: m.workflow_id, p50_ms: m.p50_duration_ms,
    first_pass_yield: m.first_pass_yield, pass_rate: m.pass_rate, spans: m.span_count })).join('\n');
  return { FlowP50Ms: number('p50_duration_ms'), FlowFirstPassYield: number('first_pass_yield'),
    FlowPassRate: number('pass_rate'), FlowSpanCount: number('span_count'),
    FlowMetrics: { rich_text: text ? Array.from({ length: Math.ceil(text.length / 2000) }, (_, i) => ({ text: { content: text.slice(i * 2000, (i + 1) * 2000) } })) : [] } };
}
