/** 服务端TaskRun是真实原生会话绑定真身；任意Task.result JSON不能自行授予远端控制。 */
export function nativeAgentAuthoritySql(alias='tasks'){
 if(alias!=='tasks')throw Error('native_agent_authority_alias');
 return `(tasks.result->'native_agent'->>'protocol'='native-agent-binding/v1'
 AND tasks.result#>>'{native_agent,request,task_id}'=tasks.id::text
 AND tasks.result#>>'{native_agent,request,run_id}'=tasks.payload->>'run_id'
 AND EXISTS(SELECT 1 FROM task_runs nr WHERE nr.task_id=tasks.id AND nr.run_id=tasks.result#>>'{native_agent,request,run_id}'
  AND nr.context->>'source'='native-agent'
  AND nr.context#>>'{native_agent,task_id}'=tasks.id::text
  AND nr.context#>>'{native_agent,run_id}'=tasks.result#>>'{native_agent,request,run_id}'
  AND nr.context#>>'{native_agent,input_digest}'=tasks.result#>>'{native_agent,request,input_digest}'
  AND nr.context#>>'{native_agent,request_nonce}'=tasks.result#>>'{native_agent,request,request_nonce}'
  AND nr.context#>'{native_agent,host}'=tasks.result#>'{native_agent,host}'))`;
}
/** 真正原生执行所有权只从服务端TaskRun与清场事件读，外部Task JSON不能授予或抹去。 */
export function nativeAgentOwnerSql(taskExpr='tasks.id'){
 if(!['tasks.id','$1'].includes(taskExpr))throw Error('native_agent_authority_alias');
 const settlement="nr.result->'native_agent_resource_settlement'";
 const identity="jsonb_build_object('task_id',nr.task_id::text,'run_id',nr.run_id,'input_digest',nr.context#>>'{native_agent,input_digest}','request_nonce',nr.context#>>'{native_agent,request_nonce}','host',nr.context#>'{native_agent,host}')";
 const reviewed=`(${settlement}->>'basis'='operator-cleanup-review' AND nr.status IN ('success','failed','timeout','cancelled')
  AND ${settlement}->>'task_run_id'=nr.id::text AND ${settlement}->>'receipt_sha256' ~ '^[a-f0-9]{64}$'
  AND ${settlement}->>'pending_action_id' ~* '^[a-f0-9-]{36}$'
  AND ${settlement}->'review' @> '{"actor":"authenticated-operator","cleanup_confirmed":true,"effects_reviewed":true}'::jsonb
  AND jsonb_array_length(CASE WHEN jsonb_typeof(${settlement}->'review'->'evidence')='array' THEN ${settlement}->'review'->'evidence' ELSE '[]'::jsonb END)>0
  AND EXISTS(SELECT 1 FROM task_events ne WHERE ne.id::text=${settlement}->>'review_event_id' AND ne.task_id=nr.task_id
   AND ne.event_type='native_agent_cleanup_reviewed' AND ne.payload @> (${identity}||jsonb_build_object('task_run_id',nr.id::text,
    'receipt_sha256',${settlement}->>'receipt_sha256','pending_action_id',${settlement}->>'pending_action_id',
    'devices',${settlement}->'devices','review',${settlement}->'review'))))`;
 const settled=`(nr.ended_at IS NOT NULL AND nr.result->>'actor'='native-agent'
  AND ${settlement} @> (${identity}||'{"protocol":"native-agent-resource-settlement/v1"}'::jsonb)
  AND ((${settlement}->>'basis'='not-started' AND nr.status='failed') OR ${reviewed})
  AND NOT EXISTS(SELECT 1 FROM device_locks nd WHERE nd.locked_by=nr.task_id::text
    AND NOT COALESCE(${settlement}->'devices' @> jsonb_build_array(jsonb_build_object('device_name',nd.device_name,'acquisition_version',nd.xmin::text)),false)))`;
 return `EXISTS(SELECT 1 FROM task_runs nr WHERE nr.task_id::text=(${taskExpr})::text AND nr.context->>'source'='native-agent'
  AND (nr.ended_at IS NULL OR (nr.context#>>'{native_agent,resource_bound}'='true' AND NOT COALESCE(${settled},false))))`;
}
export async function hasNativeAgentOwner(pool,taskId){
 return (await pool.query(`SELECT ${nativeAgentOwnerSql('$1')} AS native_owned`,[taskId])).rows[0]?.native_owned===true;
}
