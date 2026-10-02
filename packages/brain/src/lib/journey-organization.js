/** 外层别名 c 必须是 journeys；可内嵌工作流单次查询，不按部门名称猜归属。 */
export const JOURNEY_ORGANIZATION_SQL = `WITH RECURSIVE chosen AS (
  SELECT p.id AS parent_id,p.parent_journey_id AS grandparent_id,
    COALESCE(c.area_id,CASE WHEN p.parent_journey_id IS NULL THEN p.area_id END) AS effective_id
  FROM (SELECT 1) seed LEFT JOIN journeys p ON p.id=c.parent_journey_id
), ancestry AS (
  SELECT a.id,a.name,a.parent_area_id,ARRAY[a.id] AS visited,false AS cycle,0 AS depth
  FROM areas a JOIN chosen ON a.id=chosen.effective_id
  UNION ALL
  SELECT a.id,a.name,a.parent_area_id,t.visited||a.id,a.id=ANY(t.visited),t.depth+1
  FROM ancestry t JOIN areas a ON a.id=t.parent_area_id WHERE NOT t.cycle
), facts AS (
  SELECT chosen.*,
    EXISTS(SELECT 1 FROM ancestry WHERE cycle) AS area_cycle,
    EXISTS(SELECT 1 FROM ancestry a WHERE a.parent_area_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM areas p WHERE p.id=a.parent_area_id)) AS ancestor_missing,
    (c.parent_journey_id IS NOT NULL AND (chosen.parent_id IS NULL OR chosen.grandparent_id IS NOT NULL)) AS journey_invalid,
    (SELECT jsonb_build_object('id',a.id,'name',a.name,'parent_area_id',a.parent_area_id) FROM ancestry a WHERE depth=0) AS effective
  FROM chosen
)
SELECT jsonb_build_object(
  'journey_id',c.id,'capability_id',CASE WHEN c.parent_journey_id IS NOT NULL THEN c.id END,
  'capability_code',c.capability_code,
  'value_stream_id',CASE WHEN c.parent_journey_id IS NULL THEN c.id WHEN NOT f.journey_invalid THEN c.parent_journey_id END,
  'area_id',c.area_id,
  'direct_area',(SELECT jsonb_build_object('id',a.id,'name',a.name,'parent_area_id',a.parent_area_id) FROM areas a WHERE a.id=c.area_id),
  'effective_area',CASE WHEN NOT f.area_cycle AND NOT f.ancestor_missing AND NOT f.journey_invalid THEN f.effective END,
  'source',CASE WHEN f.area_cycle OR f.ancestor_missing OR f.journey_invalid OR f.effective IS NULL THEN 'unknown'
    WHEN c.area_id IS NOT NULL THEN 'direct' ELSE 'inherited' END,
  'area_path',CASE WHEN f.area_cycle OR f.ancestor_missing OR f.journey_invalid THEN '[]'::jsonb
    ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'parent_area_id',a.parent_area_id) ORDER BY depth DESC) FROM ancestry a),'[]'::jsonb) END,
  'gaps',CASE WHEN f.journey_invalid THEN '["journey_hierarchy_invalid"]'::jsonb
    WHEN f.area_cycle THEN '["area_cycle"]'::jsonb
    WHEN f.ancestor_missing OR (f.effective_id IS NOT NULL AND f.effective IS NULL) THEN '["area_missing"]'::jsonb
    WHEN f.effective_id IS NULL THEN '["area_unknown"]'::jsonb ELSE '[]'::jsonb END
) FROM facts f`;

export async function readJourneyOrganization(client, journeyId) {
  return (await client.query(`SELECT (${JOURNEY_ORGANIZATION_SQL}) AS organization FROM journeys c WHERE c.id=$1`, [journeyId])).rows[0]?.organization;
}
