import {US_SCHEDULER_ID} from './deployment.js';
import {LIVE_RUNTIME_GRANTS_SQL} from './active-grants.js';
/** 可编辑metadata不构成执行授权。所有已纳管卡片从同代许可与服务内部任务投影。 */
export async function projectLinuxExecution(pool,machines){
 const ids=machines.filter(m=>m.metadata?.onboarding).map(m=>m.id);if(!ids.length)return machines;
 let rows=[];
 try{rows=(await pool.query(`SELECT a.machine_registry_id,a.authorization_expires_at,
  LEAST(a.authorization_expires_at,(t.payload->'linux_onboarding'->>'identity_checked_at')::timestamptz+interval '3 minutes') AS verified_until FROM linux_script_authorizations a
  JOIN execution_nodes n ON n.machine_registry_id=a.machine_registry_id AND n.current_version_id=a.execution_version_id
  JOIN system_registry r ON r.id=a.machine_registry_id
  JOIN tasks t ON t.payload->'linux_onboarding'->>'machine_registry_id'=a.machine_registry_id::text
   AND ((t.payload->'linux_onboarding'->>'runtime_json')::jsonb->>'id')=a.id::text
  WHERE a.machine_registry_id=ANY($1::uuid[]) AND a.machine_registry_id<>$2 AND a.state='active'
   AND ${LIVE_RUNTIME_GRANTS_SQL}
   AND a.authorization_expires_at>clock_timestamp() AND r.status='active' AND r.metadata->>'role'='worker'
   AND COALESCE(r.metadata->>'scheduler_only','false')<>'true' AND t.status='completed' AND t.result->>'actor'='linux-pool-onboarding'
   AND t.payload->'linux_onboarding'->>'phase'='active' AND t.payload->'linux_onboarding'->>'identity_ok'='true'
   AND (t.payload->'linux_onboarding'->>'identity_checked_at')::timestamptz>clock_timestamp()-interval '3 minutes'
   AND NOT EXISTS(SELECT 1 FROM tasks newer WHERE newer.payload->'linux_onboarding'->>'machine_registry_id'=a.machine_registry_id::text
    AND (newer.created_at,newer.id)>(t.created_at,t.id))`,[ids,US_SCHEDULER_ID])).rows;}catch{/* 缺迁移或无权威事实时不报告可执行。 */}
 const active=new Map(rows.map(r=>[r.machine_registry_id,r]));
 return machines.map(m=>ids.includes(m.id)?{...m,execution:{enabled:active.has(m.id),expires_at:active.get(m.id)?.authorization_expires_at??null,verified_until:active.get(m.id)?.verified_until??null}}:m);
}
