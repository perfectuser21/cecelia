/** CI与发布入口共用的纯报告证据校验；不访问进程、文件、网络或数据库。 */
const fail=code=>{throw Object.assign(Error(code),{code});};
const objectId=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
const hashId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function provenEmptyActivities(report,side) {
  const evidence=report[side],key=side==='base'?'addition_evidence':'removal_evidence';
  if(evidence.impact_status!==(side==='base'?'known_added':'known_removed')||!Array.isArray(evidence[key])||!evidence[key].length)return false;
  const ids=new Set(evidence.definition_versions.workflows.map(v=>v.id));
  return report.affected_usages?.length>0&&report.affected_usages.every(usage=>evidence[key].some(item=>
    item.workflow_id===usage.workflow_id&&item.reference_id===usage.reference_id&&item.activity_id===usage.activity_id
    &&ids.has(item[`${side}_workflow_definition_version_id`])));
}
function assertFileCoverage(report) {
  if(!Array.isArray(report.unclaimed_paths)||report.unclaimed_paths.length||!Array.isArray(report.source.changed_files)||!report.source.changed_files.length)fail('IMPACT_FILE_COVERAGE_MISSING');
  for(const side of ['base','head'])if(!Array.isArray(report[side].file_coverage)||report[side].file_coverage.length!==report.source.changed_files.length)fail('IMPACT_FILE_COVERAGE_MISSING');
  for(const [index,change] of report.source.changed_files.entries()){
    const pair=['base','head'].map(side=>{
      const item=report[side].file_coverage[index],path=side==='base'?change.old_path||change.path:change.path;
      if(item.change_index!==index||item.path!==path||!Array.isArray(item.matched_paths)||item.truncated!==false)fail('IMPACT_FILE_COVERAGE_MISSING');
      return item;
    });
    if(!pair.some(item=>item.matched_paths.length))fail('IMPACT_FILE_COVERAGE_MISSING');
  }
}
export function assertImplementationReport(report) {
  if(report?.mapping_status!=='verified'||!Array.isArray(report.gaps)||report.gaps.length)fail('IMPACT_EVIDENCE_UNKNOWN');
  if(!objectId(report.source?.base_revision)||!objectId(report.source?.head_revision))fail('IMPACT_REVISION_REQUIRED');
  for(const side of ['base','head']){
    const evidence=report[side];
    if(evidence?.revision!==report.source[`${side}_revision`]||!hashId(evidence.graph_snapshot?.digest)
      ||evidence.graph_snapshot.source_revision!==evidence.revision
      ||!uuid(evidence.projection?.projection_run_id)||!uuid(evidence.projection?.manifest_version_id)
      ||!hashId(evidence.projection?.projection_digest)||!hashId(evidence.projection?.manifest_digest)
      ||!Array.isArray(evidence.gaps)||evidence.gaps.length
      ||evidence.traversal?.truncated!==false)fail('IMPACT_SNAPSHOT_UNKNOWN');
    for(const kind of ['workflows','activities']){
      const versions=evidence.definition_versions?.[kind];
      if(!Array.isArray(versions)||versions.some(v=>!uuid(v.id)||!hashId(v.payload_sha256))
        ||(!versions.length&&!(kind==='activities'&&provenEmptyActivities(report,side))))fail('IMPACT_DEFINITION_UNKNOWN');
    }
  }
  if(!Array.isArray(report.affected_usages)||!Array.isArray(report.required_assertions))fail('IMPACT_REPORT_INVALID');
  if(!report.affected_usages.length)fail('IMPACT_USAGE_EVIDENCE_MISSING');
  assertFileCoverage(report);
  if(report.affected_usages.length&&!report.required_assertions.length)fail('IMPACT_REGRESSION_MISSING');
  for(const usage of report.affected_usages){
    if(!Array.isArray(usage.evidence)||!usage.evidence.length)fail('IMPACT_USAGE_EVIDENCE_MISSING');
    for(const evidence of usage.evidence){
      const steps=evidence.assertion_step_ids??[null];
      if(!Array.isArray(steps)||!steps.length)fail('IMPACT_REGRESSION_MISSING');
      for(const step of steps)if(!evidence.capability_id||!evidence.activity_id||!report.required_assertions.some(item=>(item.source_bindings||[]).some(
        binding=>binding.capability_id===evidence.capability_id&&binding.activity_id===evidence.activity_id&&(binding.step_id??null)===step)))fail('IMPACT_REGRESSION_MISSING');
    }
  }
}
