export const lockOnboardingRevocation=(db,id)=>db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['linux-onboarding:'+id]);
export async function stopAutomaticOnboarding(db,machineId){
 await db.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,revoked}','true'),updated_at=now() WHERE payload->'linux_onboarding'->>'machine_registry_id'=$1",[machineId]);
 await db.query("UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,execution_revoked}','true'),updated_at=now() WHERE payload->'node_onboarding'->>'id'=$1 AND payload->'node_onboarding'->>'mode'='enroll'",[machineId]);
}
export async function internallyRetiredPool(db,id,machineId){
 return (await db.query("SELECT id FROM tasks WHERE claimed_by='linux-pool-onboarding' AND payload->>'linux_pool_retired'=$1 AND payload->'linux_onboarding'->>'machine_registry_id'=$2 AND COALESCE(payload->'linux_onboarding'->>'revoked','false')<>'true' LIMIT 1",[id,machineId])).rowCount===1;
}
