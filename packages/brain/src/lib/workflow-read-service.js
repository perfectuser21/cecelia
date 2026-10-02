/** 工作流列表、详情及活动消费者共享同一个关系读模型；单条SQL保证一致快照。 */
import { JOURNEY_ORGANIZATION_SQL } from './journey-organization.js';
const activities = `SELECT COALESCE(jsonb_agg(item ORDER BY sequence_no),'[]'::jsonb) FROM (
  SELECT r.sequence_no, to_jsonb(a) || jsonb_build_object(
    'legacy_workflow_id',a.workflow_id,'workflow_id',w.id,
    'usage',jsonb_build_object('workflow_id',w.id,'reference_id',r.id,'slot_key',r.slot_key,'sequence_no',r.sequence_no,
      'activity_definition_version_id',r.activity_definition_version_id),
    'activity_id',a.id,'canonical_id',a.id,'definition_key',a.capability_key || '.' || a.activity_key,
    'definition_status',CASE WHEN r.activity_definition_version_id IS NULL THEN 'unknown' ELSE 'versioned' END,
    'slot_key',r.slot_key,'sequence_no',r.sequence_no,'source_ref',r.source_ref,
    'source',jsonb_build_object('repo',r.source_repo,'path',r.source_path,'commit',r.source_commit),
    'steps',CASE WHEN a.contract ? 'steps' THEN
      COALESCE((SELECT jsonb_agg(COALESCE(to_jsonb(s),'{}'::jsonb) || cs.value ||
        jsonb_build_object('projection_status',CASE WHEN s.id IS NULL THEN 'unregistered' ELSE 'registered' END)
        ORDER BY (cs.value->>'order')::int)
        FROM jsonb_array_elements(a.contract->'steps') cs(value)
        LEFT JOIN steps s ON s.activity_id=a.id AND s.active AND
          s.key IN (cs.value->>'key',a.capability_key || '.' || a.activity_key || '.' || (cs.value->>'key'))),'[]'::jsonb)
      ELSE COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.step_order) FROM steps s WHERE s.activity_id=a.id AND s.active),'[]'::jsonb) END,
    'shared_components',COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('caller_type',calls.caller_type,'caller_id',calls.caller_id)
      ORDER BY e.key,calls.caller_type,calls.caller_id) FROM (
        SELECT ec.enabler_id,ec.caller_type,ec.caller_id FROM enabler_calls ec
        WHERE (ec.caller_type='activity' AND ec.caller_id=a.id)
          OR (ec.caller_type='step' AND EXISTS(SELECT 1 FROM steps st WHERE st.id=ec.caller_id AND st.activity_id=a.id AND st.active))
        UNION SELECT a.enabler_id,'activity',a.id WHERE a.enabler_id IS NOT NULL
      ) calls JOIN enablers e ON e.id=calls.enabler_id WHERE e.active),'[]'::jsonb),
    'gaps',COALESCE(a.contract->'known_gaps','[]'::jsonb) ||
      COALESCE((SELECT jsonb_agg(jsonb_build_object('step_key',s->>'key','gap','implementation_missing'))
        FROM jsonb_array_elements(COALESCE(a.contract->'steps','[]'::jsonb)) s
        WHERE s->'implementation'->>'status'='missing'),'[]'::jsonb)
  ) AS item
  FROM workflow_activity_refs r JOIN journey_steps a ON a.id=r.activity_id
  WHERE r.workflow_id=w.id AND r.active
) activity_items`;
export async function listWorkflows(pool, {capabilityId,valueStreamId,status,id} = {}) {
  const where = [], params = [];
  for (const [column,value] of [['w.capability_id',capabilityId],['c.parent_journey_id',valueStreamId],['w.status',status],['w.id',id]]) {
    if (value !== undefined) { params.push(value); where.push(`${column} = $${params.length}`); }
  }
  return (await pool.query(`SELECT w.*,c.name AS capability_name,c.capability_code,c.parent_journey_id AS value_stream_id,
    CASE WHEN w.current_definition_version_id IS NULL THEN 'unknown' ELSE 'versioned' END AS definition_status,
    (${JOURNEY_ORGANIZATION_SQL}) AS organization,
    (SELECT count(*)::int FROM workflow_activity_refs r WHERE r.workflow_id=w.id AND r.active) AS activity_count,
    (${activities}) AS activities
    FROM workflows w
    JOIN journeys c ON c.id = w.capability_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY w.key`,params)).rows;
}
export async function readWorkflowActivities(pool,workflowId) {
  return (await listWorkflows(pool,{id:workflowId}))[0]?.activities || [];
}
export async function readActivity(pool, activityId) {
  return (await pool.query(`SELECT a.*,a.id AS canonical_id,
    CASE WHEN v.id IS NULL THEN 'unknown' ELSE 'versioned' END AS definition_status,
    to_jsonb(v) AS definition_version
    FROM journey_steps a LEFT JOIN activity_definition_versions v
      ON v.activity_id=a.id AND v.id=a.current_definition_version_id WHERE a.id=$1`, [activityId])).rows[0];
}
export async function readActivityConsumers(pool,activityId) {
  return (await pool.query(`SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(consumer) ORDER BY consumer.key,consumer.sequence_no),'[]'::jsonb)
    FROM (SELECT w.id AS workflow_id,w.key,w.name,w.capability_id,r.slot_key,r.sequence_no,
      r.source_ref,r.source_repo,r.source_path,r.source_commit FROM workflow_activity_refs r
      JOIN workflows w ON w.id=r.workflow_id WHERE r.activity_id=a.id AND r.active) consumer) AS consumers
    FROM journey_steps a WHERE a.id=$1`,[activityId])).rows[0]?.consumers;
}
