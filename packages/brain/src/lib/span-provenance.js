/** v2只核运行已固定的定义；旧记录不从当前版本补造身份。 */
export const SPAN_IDENTITY_FIELDS=['run_binding_id','reference_id','workflow_definition_version_id','activity_definition_version_id','attempt_key','enabler_call_id'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,message)=>{throw Object.assign(Error(message||code),{code:`SPAN_${code}`,status:422});};
export function normalizeSpanProvenance(raw) {
  const protocol=raw.identity_protocol??1;
  if(protocol!==1&&protocol!==2)fail('IDENTITY_PROTOCOL_INVALID');
  if(protocol===1){
    if(SPAN_IDENTITY_FIELDS.some(field=>raw[field]!=null))fail('IDENTITY_PROTOCOL_REQUIRED');
    return {identity_protocol:1};
  }
  const identity={identity_protocol:2};
  for(const field of SPAN_IDENTITY_FIELDS){
    const value=raw[field];
    if(field==='enabler_call_id'&&value==null){identity[field]=null;continue;}
    if(field==='attempt_key'){
      if(typeof value!=='string'||!value.trim()||value.length>256)fail('ATTEMPT_KEY_REQUIRED');
      identity[field]=value;continue;
    }
    if(typeof value!=='string'||!UUID.test(value))fail('IDENTITY_REQUIRED',`${field}必须是固定UUID`);
    identity[field]=value.toLowerCase();
  }
  if(typeof raw.occurrence_key!=='string'||!raw.occurrence_key.trim())fail('OCCURRENCE_REQUIRED');
  if(raw.outcome==='skipped'&&(typeof raw.evidence?.skip_reason!=='string'||!raw.evidence.skip_reason.trim()))fail('SKIP_REASON_REQUIRED');
  return identity;
}

export function validateSpanBinding(row,context) {
  if(row.identity_protocol!==2)fail('IDENTITY_PROTOCOL_REQUIRED');
  const span=row.normalized,identity=row.provenance;
  const {binding,release,workflow,activities=[]}=context||{};
  if(!binding||!release||!workflow)fail('RUN_BINDING_MISSING');
  if(binding.payload?.runtime_snapshot_sha256&&span.evidence?.runtime_snapshot_sha256!==binding.payload.runtime_snapshot_sha256)fail('RUNTIME_SNAPSHOT_MISMATCH');
  if(binding.id!==identity.run_binding_id||binding.run_id!==span.run_id
    ||binding.workflow_id!==span.workflow_id||binding.workflow_definition_version_id!==identity.workflow_definition_version_id
    ||binding.attempt_key!==identity.attempt_key)fail('RUN_IDENTITY_MISMATCH');
  if(workflow.id!==identity.workflow_definition_version_id||workflow.workflow_id!==span.workflow_id)fail('WORKFLOW_VERSION_MISMATCH');
  const ref=workflow.payload.activities.find(item=>item.reference_id===identity.reference_id);
  if(!ref||ref.activity_id!==span.activity_id||ref.activity_version_id!==identity.activity_definition_version_id)fail('ACTIVITY_USAGE_MISMATCH');
  const activity=activities.find(item=>item.id===identity.activity_definition_version_id&&item.activity_id===span.activity_id);
  if(!activity)fail('ACTIVITY_VERSION_MISSING');
  if(span.step_id&&!activity.payload.steps.some(step=>step.step_id===span.step_id))fail('STEP_OWNERSHIP_MISMATCH');
  if(span.enabler_id||identity.enabler_call_id){
    const call=release.payload.allowed_enabler_calls.find(item=>item.id===identity.enabler_call_id&&item.enabler_id===span.enabler_id);
    if(!call||call.activity_id!==span.activity_id||call.source_status!=='verified')fail('ENABLER_OWNERSHIP_MISMATCH');
    if(call.caller_type==='step'&&(call.caller_id!==span.step_id||call.step_id!==span.step_id))fail('ENABLER_CALLER_MISMATCH');
    if(call.caller_type==='activity'&&(call.caller_id!==span.activity_id||span.step_id))fail('ENABLER_CALLER_MISMATCH');
    if(!['step','activity'].includes(call.caller_type))fail('ENABLER_CALLER_MISMATCH');
  }
}
