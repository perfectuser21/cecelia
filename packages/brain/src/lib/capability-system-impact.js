/** 浏览器影响视图只展示身份和覆盖信息；执行命令留在受保护CI报告。 */
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>[k,row[k]]));
const sourceFields=['repo','path','kind','revision','digest','base_revision','head_revision','changed_files'];
const usageFields=['workflow_id','reference_id','activity_id','capability_id','capability_ids','sides','activity_definition_version_id','workflow_definition_version_id','slot_key','sequence_no','assertion_step_ids','source_repo','implementation_repo'];
const versionFields=['id','workflow_id','activity_id','source_repo','source_path','source_commit','payload_sha256','contract_sha256'];
const gapFields=['code','side','repo','revision','path','old_path','workflow_id','activity_id','activity_definition_version_id','step_id','expected','actual','count'];
const gap=g=>pick(g,gapFields);
function usage(u){return {...pick(u,usageFields),...(u.implementation&&{implementation:pick(u.implementation,sourceFields)}),...(u.evidence&&{evidence:u.evidence.map(e=>({...pick(e,['side','revision']),...usage(e)}))})};}
function assertion(a){return {...pick(a,['assertion_ref','source_repo','capability_ids','sides','validation_status']),source_bindings:(a.source_bindings||[]).map(b=>pick(b,['assertion_source','source_repo','capability_id','journey_step_link_id','assertion_revision','assertion_digest','activity_id','step_id','side']))};}
function side(s){
  return {...pick(s,['revision','organization_status','mapping_status','impact_status']),
    definition_versions:{workflows:(s.definition_versions?.workflows||[]).map(v=>pick(v,versionFields)),activities:(s.definition_versions?.activities||[]).map(v=>pick(v,versionFields))},
    affected_usages:(s.affected_usages||[]).map(usage),required_assertions:(s.required_assertions||[]).map(assertion),gaps:(s.gaps||[]).map(gap),
    file_coverage:(s.file_coverage||[]).map(f=>pick(f,['change_index','path','matched_paths','truncated']))};
}
export function systemImpactProjection(report){
  return {...pick(report,['scope_key','registry_repo','truncated','mapping_status','verification_status']),source:pick(report.source,sourceFields),
    base:side(report.base),head:side(report.head),affected_usages:(report.affected_usages||[]).map(usage),
    required_assertions:(report.required_assertions||[]).map(assertion),gaps:(report.gaps||[]).map(gap),
    unclaimed_paths:(report.unclaimed_paths||[]).map(p=>pick(p,['path','old_path']))};
}
