import {execFileSync} from 'node:child_process';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {runRegisteredAssertions} from './implementation-gate.mjs';
import {collectGovernanceEvidence} from './registry-lint.mjs';
import {collectAuxiliarySourceEvidence,assertAuxiliarySourceEvidence} from './implementation-auxiliary-evidence.mjs';
/** 联合证据保留领域切片，外层完整Git差异单独验收，不伪造一个投影。 */
import {createHash} from 'node:crypto';
import {assertImplementationReport} from '../../packages/brain/src/lib/implementation-report.js';
import {validateImplementationImpact} from '../../packages/brain/src/lib/implementation-impact.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const key=change=>JSON.stringify([change.path,change.old_path??null]);
export function aggregateScopedImplementationEvidence({source,expectedScopes,reports}){
  if(!Array.isArray(expectedScopes)||!expectedScopes.length||new Set(expectedScopes).size!==expectedScopes.length||
    !Array.isArray(reports)||reports.length!==expectedScopes.length)fail('IMPACT_MULTISCOPE_SCOPES_REQUIRED');
  const normalized=validateImplementationImpact({scope:expectedScopes[0],repo:source?.repo,base_revision:source?.base_revision,head_revision:source?.head_revision,changed_files:source?.changed_files});
  const changes=normalized.changed_files,known=new Set(changes.map(key));
  if(known.size!==changes.length)fail('IMPACT_MULTISCOPE_DIFF_DUPLICATE');
  const seen=new Set(),claims=new Map(changes.map(c=>[key(c),[]]));
  for(const report of reports){
    if(!expectedScopes.includes(report?.scope_key)||seen.has(report.scope_key))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
    seen.add(report.scope_key);
    if(report.source?.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision)
      fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    // UNKNOWN、断言遗漏、source/图错误必须在各自领域内拒绝，不借另一个领域的PASS。
    assertImplementationReport(report);
    for(const change of report.source.changed_files){
      if(!known.has(key(change)))fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
      claims.get(key(change)).push({scope_key:report.scope_key,report_sha256:sha(report)});
    }
  }
  if([...claims.values()].some(v=>!v.length))fail('IMPACT_MULTISCOPE_FILE_UNCLAIMED');
  const body={schema_version:2,evidence_kind:'scoped_implementation_admission',source:{repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:changes},
    purpose:'admission_only',scope_reports:structuredClone(reports),
    file_coverage:changes.map(c=>({...c,claims:claims.get(key(c))})),
    business_runtime_status:'not_evaluated'};
  return {...body,evidence_sha256:sha(body)};
}

export function verifyScopedImplementationGitSource(repoRoot,proof){
  const rebuilt=aggregateScopedImplementationEvidence({source:proof?.source,expectedScopes:(proof?.scope_reports||[]).map(r=>r.scope_key),reports:proof?.scope_reports});
  const {evidence_sha256,...body}=proof;
  if(evidence_sha256!==sha(body)||evidence_sha256!==rebuilt.evidence_sha256)fail('IMPACT_MULTISCOPE_DIGEST_MISMATCH');
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
  const source=proof.source,repo=canonicalRepoIdentity(git('remote','get-url','origin')).replace(/^github\.com\//,'');
  if(repo!==source.repo||git('rev-parse','HEAD')!==source.head_revision)fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
  if(git('status','--porcelain=v1','--untracked-files=no'))fail('IMPACT_MULTISCOPE_SOURCE_DIRTY');
  git('merge-base','--is-ancestor',source.base_revision,source.head_revision);
  const actual=execFileSync('git',['diff','--no-renames','--name-only','-z',source.base_revision,source.head_revision,'--'],{cwd:repoRoot,encoding:'utf8'}).split('\0').filter(Boolean).sort();
  const claimed=[...new Set(source.changed_files.flatMap(c=>[c.path,...(c.old_path?[c.old_path]:[])]))].sort();
  if(JSON.stringify(actual)!==JSON.stringify(claimed))fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
  return rebuilt;
}

/** 每个输入仍是完整差异的原生报告；仅明确的foreign文件缺归属可由另一领域真实调用闭包解释。 */
export function resolveScopedImplementationReports({source,expectedScopes,reports}){
  const resolutions=[],parts=[],owners=new Map();
  if(!Array.isArray(reports)||!Array.isArray(expectedScopes)||reports.length!==expectedScopes.length)fail('IMPACT_MULTISCOPE_SCOPES_REQUIRED');
  for(const report of reports){
    if(report.source?.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision||
      JSON.stringify(report.source.changed_files)!==JSON.stringify(source.changed_files))fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
    for(const [index,change] of source.changed_files.entries()){
      // 只认原生调用图命中；governance/辅助说明无法替别人的业务代码认领。
      const matched=['base','head'].some(side=>report[side]?.file_coverage?.[index]?.matched_paths?.length);
      if(matched){const list=owners.get(key(change))||[];list.push(report.scope_key);owners.set(key(change),list);}
    }
  }
  for(const report of reports){
    const indexes=source.changed_files.flatMap((change,index)=>owners.get(key(change))?.includes(report.scope_key)?[index]:[]);
    if(!indexes.length)fail('IMPACT_MULTISCOPE_SCOPE_WITHOUT_NATIVE_CLAIM');
    for(const gap of report.gaps||[]){
      if(gap.code!=='changed_file_unclaimed'||gap.side)fail('IMPACT_MULTISCOPE_UNRESOLVED_UNKNOWN');
      const change=source.changed_files.find(c=>c.path===gap.path&&(c.old_path??null)===(gap.old_path??null));
      const other=change&&(owners.get(key(change))||[]).filter(s=>s!==report.scope_key);
      if(!other?.length)fail('IMPACT_MULTISCOPE_FILE_UNCLAIMED');
      resolutions.push({scope_key:report.scope_key,path:change.path,claimed_by_scopes:other,source_report_sha256:sha(report)});
    }
    const part=structuredClone(report);
    part.source.changed_files=indexes.map(i=>source.changed_files[i]);
    for(const side of ['base','head'])part[side].file_coverage=indexes.map((i,change_index)=>({...part[side].file_coverage[i],change_index}));
    part.gaps=[];part.unclaimed_paths=[];part.mapping_status='verified';
    // 所有side图/定义/回归证据及辅助owner UNKNOWN保留，由原校验完整拒绝。
    assertImplementationReport(part);parts.push(part);
  }
  const proof=aggregateScopedImplementationEvidence({source,expectedScopes,reports:parts});
  const body={schema_version:1,evidence:proof,source_reports:structuredClone(reports),resolved_foreign_paths:resolutions};
  return {...body,resolution_sha256:sha(body)};
}

export async function runScopedImplementationGate({repoRoot,evidence,timeoutMs=300000}){
  verifyScopedImplementationGitSource(repoRoot,evidence);
  const receipts=[];
  for(const report of evidence.scope_reports){
    assertAuxiliarySourceEvidence(report);
    const governance=collectGovernanceEvidence(repoRoot,report.source);
    if(JSON.stringify(governance?.files||[])!==JSON.stringify(report.governance_evidence?.files||[]))fail('IMPACT_GOVERNANCE_SOURCE_MISMATCH');
    const auxiliary=collectAuxiliarySourceEvidence(repoRoot,report.source);
    if(auxiliary?.evidence_sha256!==report.auxiliary_source_evidence?.evidence_sha256)fail('AUXILIARY_SOURCE_BYTES_MISMATCH');
    const assertions=await runRegisteredAssertions({repoRoot,source:evidence.source,required_assertions:report.required_assertions,timeoutMs});
    receipts.push({schema_version:1,actor:'implementation_ci_gate',scope_key:report.scope_key,source:report.source,
      report_sha256:sha(report),assertions,verdict:assertions.every(a=>a.exit_code===0&&!a.error)?'PASS':'FAIL',
      purpose:'admission_only',business_runtime_status:'not_evaluated'});
  }
  verifyScopedImplementationGitSource(repoRoot,evidence);
  return {schema_version:2,actor:'implementation_ci_gate',evidence_kind:'scoped_implementation_admission',source:evidence.source,
    evidence_sha256:evidence.evidence_sha256,scope_receipts:receipts,purpose:'admission_only',
    verdict:receipts.every(r=>r.verdict==='PASS')?'PASS':'FAIL',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString()};
}
