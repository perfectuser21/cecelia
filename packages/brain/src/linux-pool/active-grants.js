// 两处执行投影与续验共用实际许可链；别名a必须为linux_script_authorizations。
export const UNREVOKED_RUNTIME_GRANTS_SQL=`EXISTS(SELECT 1 FROM execution_node_versions v WHERE v.id=a.execution_version_id AND v.state='active')
 AND jsonb_typeof(a.grant_ids)='object' AND a.grant_ids<>'{}'::jsonb
 AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(a.grant_ids) expected WHERE NOT EXISTS(
  SELECT 1 FROM execution_grants g WHERE g.id::text=expected.value AND g.node_version_id=a.execution_version_id
   AND g.profile_id=expected.key AND g.surface='managed_script' AND g.provider='script' AND g.state='active'))`;
export const LIVE_RUNTIME_GRANTS_SQL=`(${UNREVOKED_RUNTIME_GRANTS_SQL}) AND NOT EXISTS(
 SELECT 1 FROM jsonb_each_text(a.grant_ids) expected JOIN execution_grants g ON g.id::text=expected.value
 WHERE g.expires_at IS NULL OR g.expires_at<=clock_timestamp())`;
