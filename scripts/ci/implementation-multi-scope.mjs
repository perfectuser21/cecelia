import {execFileSync} from 'node:child_process';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {runRegisteredAssertions} from './implementation-gate.mjs';
import {collectGovernanceEvidence} from './registry-lint.mjs';
import {assertGovernanceCoverage} from '../../packages/brain/src/lib/implementation-ci-governance.js';
import {collectAuxiliarySourceEvidence,assertAuxiliarySourceEvidence,SOURCE_RELATIONS_PATH} from './implementation-auxiliary-evidence.mjs';
/** 联合证据保留领域切片，外层完整Git差异单独验收，不伪造一个投影。 */
import {createHash} from 'node:crypto';
import {assertImplementationReport} from '../../packages/brain/src/lib/implementation-report.js';
import {validateImplementationImpact} from '../../packages/brain/src/lib/implementation-impact.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const key=change=>JSON.stringify([change.path,change.old_path??null]);
/** Joint validation preserves each native owner graph; foreign usages never enter a scope report. */
function auxiliaryScopeContext(source,expectedScopes,reports){
  if(!reports.some(r=>r.auxiliary_source_evidence))return null;
  if(reports.length!==expectedScopes.length||new Set(reports.map(r=>r.scope_key)).size!==reports.length||reports.some(r=>!expectedScopes.includes(r.scope_key)))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
  const frozen=reports[0].auxiliary_source_evidence;
  if(!frozen)fail('IMPACT_MULTISCOPE_AUXILIARY_SOURCE_MISMATCH');
  for(const report of reports){
    if(report.source.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision||JSON.stringify(report.source.changed_files)!==JSON.stringify(source.changed_files))fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    assertAuxiliarySourceEvidence(report);
    if(report.auxiliary_source_evidence?.evidence_sha256!==frozen.evidence_sha256)fail('IMPACT_MULTISCOPE_AUXILIARY_SOURCE_MISMATCH');
  }
  const ownerClaims=[];
  for(const side of ['base','head']){
    const rows=frozen[side].relations;
    for(const path of [...new Set(rows.map(r=>r.owner_path))].sort()){
      const relations=rows.filter(r=>r.owner_path===path);
      if(new Set(relations.map(r=>r.owner_sha256)).size!==1)fail('IMPACT_MULTISCOPE_AUXILIARY_SOURCE_MISMATCH');
      const claims=[];
      for(const report of reports){
        const owner=report.auxiliary_source_evidence.owner_coverage[side].find(o=>o.path===path);
        // The existing validator checks these paths against this scope's native usages and graph.
        if(owner?.matched_paths.length)claims.push({scope_key:report.scope_key,source_report_sha256:sha(report),graph_sha256:owner.graph_sha256,matched_paths:[...owner.matched_paths]});
      }
      if(!claims.length)fail('IMPACT_MULTISCOPE_AUXILIARY_OWNER_UNKNOWN');
      ownerClaims.push({side,owner_path:path,owner_sha256:relations[0].owner_sha256,source_revision:source[`${side}_revision`],claims});
    }
  }
  const jointFiles=[];
  if(source.changed_files.some(c=>c.path===SOURCE_RELATIONS_PATH)){
    if(source.changed_files.find(c=>c.path===SOURCE_RELATIONS_PATH).old_path)fail('IMPACT_MULTISCOPE_AUXILIARY_SOURCE_MISMATCH');
    if(!ownerClaims.length)fail('IMPACT_MULTISCOPE_AUXILIARY_OWNER_UNKNOWN');
    jointFiles.push({path:SOURCE_RELATIONS_PATH,base_sha256:frozen.base.manifest_sha256,head_sha256:frozen.head.manifest_sha256,
      owner_claims:ownerClaims.map((c,index)=>index)});
  }
  const body={schema_version:1,source:structuredClone(source),source_reports:structuredClone(reports),owner_claims:ownerClaims,joint_files:jointFiles};
  return {...body,context_sha256:sha(body)};
}
function verifyAuxiliaryScopeContext(source,scopes,context){
  if(!context)return null;
  const rebuilt=auxiliaryScopeContext(source,scopes,context.source_reports||[]);
  if(!rebuilt||sha(rebuilt)!==sha(context))fail('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
  return rebuilt;
}
function assertScopedAuxiliaryReport(report,context){
  if(!context)return assertAuxiliarySourceEvidence(report);
  const raw=context.source_reports.find(r=>r.scope_key===report.scope_key);
  if(!raw||sha(raw.auxiliary_source_evidence)!==sha(report.auxiliary_source_evidence))fail('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
  assertAuxiliarySourceEvidence(raw);
  // No native/auxiliary claim or affected usage may be injected while slicing the original report.
  if(sha(raw.affected_usages)!==sha(report.affected_usages)||sha(raw.required_assertions)!==sha(report.required_assertions))fail('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
  for(const side of ['base','head']){
    const {file_coverage:_a,...actual}=report[side],{file_coverage:_b,...originalSide}=raw[side];
    if(sha(actual)!==sha(originalSide))fail('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
    for(const file of report[side].file_coverage){
      const original=raw[side].file_coverage.find(f=>f.path===file.path);
      const {change_index:_c,...left}=file,{change_index:_d,...right}=original||{};
      if(sha(left)!==sha(right))fail('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
    }
  }
  return true;
}
export function aggregateScopedImplementationEvidence({source,expectedScopes,reports,auxiliary_scope_context}){
  if(!Array.isArray(expectedScopes)||!expectedScopes.length||new Set(expectedScopes).size!==expectedScopes.length||
    !Array.isArray(reports)||reports.length!==expectedScopes.length)fail('IMPACT_MULTISCOPE_SCOPES_REQUIRED');
  const normalized=validateImplementationImpact({scope:expectedScopes[0],repo:source?.repo,base_revision:source?.base_revision,head_revision:source?.head_revision,changed_files:source?.changed_files});
  const changes=normalized.changed_files,known=new Set(changes.map(key));
  if(known.size!==changes.length)fail('IMPACT_MULTISCOPE_DIFF_DUPLICATE');
  const context=verifyAuxiliaryScopeContext(source,expectedScopes,auxiliary_scope_context);
  const seen=new Set(),claims=new Map(changes.map(c=>[key(c),[]]));
  for(const report of reports){
    if(!Array.isArray(report.gaps)||report.mapping_status==='unknown'&&!report.gaps.length||
      ['base','head'].some(side=>report[side]?.mapping_status==='unknown'))fail('IMPACT_MULTISCOPE_UNRESOLVED_UNKNOWN');
    if(!expectedScopes.includes(report?.scope_key)||seen.has(report.scope_key))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
    seen.add(report.scope_key);
    if(report.source?.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision)
      fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    // UNKNOWN、断言遗漏、source/图错误必须在各自领域内拒绝，不借另一个领域的PASS。
    assertImplementationReport(report);
    assertScopedAuxiliaryReport(report,context);
    for(const change of report.source.changed_files){
      if(!known.has(key(change)))fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
      claims.get(key(change)).push({scope_key:report.scope_key,report_sha256:sha(report)});
    }
  }
  for(const joint of context?.joint_files||[]){
    const change=changes.find(c=>c.path===joint.path);
    if(!change)fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
    const scopes=[...new Set(context.owner_claims.flatMap(o=>o.claims.map(c=>c.scope_key)))];
    claims.set(key(change),scopes.map(scope_key=>({scope_key,coverage_kind:'scoped_auxiliary_source',context_sha256:context.context_sha256})));
  }
  if([...claims.values()].some(v=>!v.length))fail('IMPACT_MULTISCOPE_FILE_UNCLAIMED');
  const body={schema_version:2,evidence_kind:'scoped_implementation_admission',source:{repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:changes},
    purpose:'admission_only',scope_reports:structuredClone(reports),
    ...(context?{auxiliary_scope_context:context}:{}),
    file_coverage:changes.map(c=>({...c,claims:claims.get(key(c))})),
    business_runtime_status:'not_evaluated'};
  return {...body,evidence_sha256:sha(body)};
}

export function verifyScopedImplementationGitSource(repoRoot,proof){
  const rebuilt=aggregateScopedImplementationEvidence({source:proof?.source,expectedScopes:(proof?.scope_reports||[]).map(r=>r.scope_key),reports:proof?.scope_reports,auxiliary_scope_context:proof?.auxiliary_scope_context});
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
  const context=auxiliaryScopeContext(source,expectedScopes,reports);
  for(const report of reports){
    if(!Array.isArray(report.gaps)||report.mapping_status==='unknown'&&!report.gaps.length||
      ['base','head'].some(side=>report[side]?.mapping_status==='unknown'))fail('IMPACT_MULTISCOPE_UNRESOLVED_UNKNOWN');
    if(report.source?.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision||
      JSON.stringify(report.source.changed_files)!==JSON.stringify(source.changed_files))fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
    for(const [index,change] of source.changed_files.entries()){
      // 只认原生调用图命中；governance/辅助说明无法替别人的业务代码认领。
      const matched=['base','head'].some(side=>report[side]?.file_coverage?.[index]?.matched_paths?.length);
      const governance=['base','head'].every(side=>report[side]?.file_coverage?.[index]?.coverage_kind==='governance');
      if(governance)assertGovernanceCoverage(report,change.path);
      if(matched||governance){const list=owners.get(key(change))||[];list.push(report.scope_key);owners.set(key(change),list);}
    }
  }
  for(const report of reports){
    const indexes=source.changed_files.flatMap((change,index)=>!context?.joint_files.some(f=>f.path===change.path)&&owners.get(key(change))?.includes(report.scope_key)?[index]:[]);
    if(!indexes.length)fail('IMPACT_MULTISCOPE_SCOPE_WITHOUT_NATIVE_CLAIM');
    for(const gap of report.gaps||[]){
      if(gap.code==='auxiliary_owner_unclaimed'&&context){
        const rows=context.owner_claims.filter(c=>c.owner_path===gap.path&&(!gap.side||c.side===gap.side));
        if(!rows.length)fail('IMPACT_MULTISCOPE_AUXILIARY_OWNER_UNKNOWN');
        resolutions.push({scope_key:report.scope_key,side:gap.side??null,path:gap.path,coverage_kind:'scoped_auxiliary_owner',context_sha256:context.context_sha256,claimed_by_scopes:[...new Set(rows.flatMap(r=>r.claims.map(c=>c.scope_key)))]});
        continue;
      }
      if(gap.code!=='changed_file_unclaimed'||gap.side)fail('IMPACT_MULTISCOPE_UNRESOLVED_UNKNOWN');
      const change=source.changed_files.find(c=>c.path===gap.path&&(c.old_path??null)===(gap.old_path??null));
      if(change&&context?.joint_files.some(f=>f.path===change.path)){
        resolutions.push({scope_key:report.scope_key,path:change.path,coverage_kind:'scoped_auxiliary_source',context_sha256:context.context_sha256});continue;
      }
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
  const proof=aggregateScopedImplementationEvidence({source,expectedScopes,reports:parts,auxiliary_scope_context:context});
  const body={schema_version:1,evidence:proof,source_reports:structuredClone(reports),resolved_foreign_paths:resolutions};
  return {...body,resolution_sha256:sha(body)};
}

export async function runScopedImplementationGate({repoRoot,evidence,timeoutMs=300000}){
  verifyScopedImplementationGitSource(repoRoot,evidence);
  const receipts=[];
  for(const report of evidence.scope_reports){
    assertScopedAuxiliaryReport(report,evidence.auxiliary_scope_context);
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
    ...(evidence.auxiliary_scope_context?{auxiliary_scope_receipt:{schema_version:1,purpose:'admission_only',
      context_sha256:evidence.auxiliary_scope_context.context_sha256,owner_claims:evidence.auxiliary_scope_context.owner_claims,
      joint_files:evidence.auxiliary_scope_context.joint_files,verdict:'PASS',business_runtime_status:'not_evaluated'}}:{}),
    verdict:receipts.every(r=>r.verdict==='PASS')?'PASS':'FAIL',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString()};
}
