/** 注册lint只认中央UUID与固定声明，新增身份缺登记时给定位缺口。 */
import { canonicalJson } from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
export function lintImplementationRegistry(snapshot,plans,digest){
  const gaps=[],gap=(code,details)=>gaps.push({code,...details});
  for(const capability of Object.keys(digest.capabilities||{}))if(!snapshot.canonical.workflows.some(w=>w.source_capability===capability))gap('workflow_registration_missing',{capability});
  for(const plan of plans)for(const item of plan.activities){
    const a=item.activity,identity=`${a.from}.${a.key}`;
    const registered=snapshot.canonical.activities.filter(r=>r.capability_key===a.from&&r.activity_key===a.key);
    if(registered.length!==1){gap('activity_registration_missing',{identity});continue;}
    const owner=registered[0];
    if(!snapshot.canonical.references.some(r=>r.workflow_id===plan.workflow.id&&r.slot_key===a.key&&r.activity_id===owner.id))gap('reference_registration_missing',{workflow_id:plan.workflow.id,activity_id:owner.id,slot_key:a.key});
    for(const step of a.steps||[]){
      const steps=snapshot.canonical.steps.filter(s=>s.activity_id===owner.id&&(s.key===step.key||s.key===`${identity}.${step.key}`));
      if(steps.length!==1)gap('step_registration_missing',{activity_id:owner.id,step_key:step.key});
    }
    const {from:_from,...contract}=a;
    if(canonicalJson(contract)!==canonicalJson(owner.contract)){
      const bindings=(item.bindings||[]).filter(b=>['code','skill'].includes(b.kind)&&b.status==='verified');
      if(!bindings.length)gap('changed_activity_implementation_missing',{activity_id:owner.id,identity});
      for(const binding of bindings){
        const step=binding.scope==='step'?snapshot.canonical.steps.find(s=>s.activity_id===owner.id&&(s.key===binding.step_key||s.key===`${identity}.${binding.step_key}`))?.id:null;
        if(!snapshot.assertions.some(r=>r.journey_id===plan.workflow.capability_id&&r.step_id===owner.id&&(r.step_id_ref||null)===(step||null)&&r.assertion_ref))
          gap('changed_activity_regression_missing',{capability_id:plan.workflow.capability_id,activity_id:owner.id,step_id:step||null});
      }
    }
  }
  return {status:gaps.length?'unknown':'verified',gaps};
}

// 固定脚本独立核验；不执行报告携带的command。
import { execFileSync,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyGovernanceChange,assertGovernanceCoverage,normalizeVersionJson,GOVERNANCE_CHECKS,GOVERNANCE_POLICY_SHA256 } from '../../packages/brain/src/lib/implementation-ci-governance.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function collectGovernanceEvidence(repoRoot,source,{runChecks=true}={}){
  const files=[];
  const read=(revision,path)=>{try{return execFileSync('git',['show',`${revision}:${path}`],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{return null;}};
  for(const change of source.changed_files){
    if(change.old_path&&change.old_path!==change.path)continue;
    const before=read(source.base_revision,change.path),after=read(source.head_revision,change.path);
    const kind=classifyGovernanceChange(source.repo,change.path,before,after);if(!kind)continue;
    files.push({path:change.path,kind,base_sha256:sha(before),head_sha256:sha(after),...(kind==='version_only'&&{normalized_sha256:sha(normalizeVersionJson(before))})});
  }
  if(!files.length)return null;
  const checks=[],trustedRoot=fileURLToPath(new URL('../../',import.meta.url));
  if(runChecks)for(const rule of GOVERNANCE_CHECKS){
    const committed=read(source.head_revision,rule.path),trusted=readFileSync(join(trustedRoot,rule.path),'utf8');
    if(committed!==trusted||readFileSync(join(repoRoot,rule.path),'utf8')!==committed)throw Object.assign(Error(`治理校验脚本与受信版本不同: ${rule.path}`),{code:'IMPACT_GOVERNANCE_TOOL_CHANGED'});
    const executable=rule.runtime==='node'?process.execPath:'/bin/bash';
    const result=spawnSync(executable,[join(repoRoot,rule.path),...(rule.args||[])],{cwd:repoRoot,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,
      env:{PATH:`${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8'}});
    checks.push({id:rule.id,path:rule.path,script_sha256:sha(trusted),exit_code:result.status,error:result.error?.code||result.signal||null,stdout_sha256:sha(result.stdout||''),stderr_sha256:sha(result.stderr||'')});
    if(result.status!==0||result.error||result.signal)throw Object.assign(Error(`独立治理检查失败: ${rule.id}`),{code:'IMPACT_GOVERNANCE_CHECK_FAILED',checks});
  }
  return {policy_sha256:GOVERNANCE_POLICY_SHA256,source:{repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision},files,checks};
}
export function applyGovernanceCoverage(report,evidence){
  if(!evidence)return report;
  const paths=new Set(evidence.files.map(f=>f.path));report.governance_evidence=evidence;
  report.unclaimed_paths=report.unclaimed_paths.filter(c=>!paths.has(c.path));
  report.gaps=report.gaps.filter(g=>g.code!=='changed_file_unclaimed'||!paths.has(g.path));
  for(const side of ['base','head'])for(const file of report[side].file_coverage)if(paths.has(file.path))file.coverage_kind='governance';
  if(report.ci_context?.purpose==='admission_only'&&!report.affected_usages.length
    &&report.source.changed_files.length&&report.source.changed_files.every(c=>!c.old_path&&paths.has(c.path))){
    for(const change of report.source.changed_files)assertGovernanceCoverage(report,change.path);
    for(const side of ['base','head']){report[side].gaps=report[side].gaps.filter(g=>g.code!=='implementation_mapping_missing');report[side].mapping_status=report[side].gaps.length?'unknown':'verified';}
    report.gaps=report.gaps.filter(g=>g.code!=='implementation_mapping_missing');report.impact_status='governance_only';
  }
  report.mapping_status=report.gaps.length?'unknown':'verified';return report;
}
