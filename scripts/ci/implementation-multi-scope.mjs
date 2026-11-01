import {assertVerificationInputContext,verifyVerificationInputContext,verifyVerificationInputContextAuthority} from './implementation-verification-context.mjs';
import {execFileSync} from 'node:child_process';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {runRegisteredAssertions} from './implementation-gate.mjs';
import {collectGovernanceEvidence} from './registry-lint.mjs';
import {assertGovernanceCoverage} from '../../packages/brain/src/lib/implementation-ci-governance.js';
import {collectAuxiliarySourceEvidence,assertAuxiliarySourceEvidence,SOURCE_RELATIONS_PATH} from './implementation-auxiliary-evidence.mjs';
/** 联合证据保留领域切片，外层完整Git差异单独验收，不伪造一个投影。 */
import {createHash} from 'node:crypto';
import {assertImplementationReport,assertJointNoOwnedImplementationReport} from '../../packages/brain/src/lib/implementation-report.js';
import {validateImplementationImpact} from '../../packages/brain/src/lib/implementation-impact.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const supportedCeceliaScopes=scopes=>['["cecelia-kr","cecelia-factory"]','["cecelia-kr","cecelia-factory","cecelia-infra"]'].includes(JSON.stringify(scopes));
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
function verificationContext(source,reports,context,purpose){
 if(!context)return null;
 return assertVerificationInputContext({source,reports,context,purpose});
}
function assertScopedVerificationReport(report,context){
 if(!context)return;
 const raw=context.source_reports.find(r=>r.scope_key===report.scope_key);if(!raw)fail('IMPACT_MULTISCOPE_VERIFICATION_CONTEXT_MISMATCH');
 const body=r=>{const {source,gaps,unclaimed_paths,mapping_status,base,head,...rest}=r;
  const side=value=>{const {file_coverage,...metadata}=value;return metadata;};return {...rest,source:{...source,changed_files:[]},base:side(base),head:side(head)};};
 if(sha(body(raw))!==sha(body(report)))fail('IMPACT_MULTISCOPE_VERIFICATION_CONTEXT_MISMATCH');
 for(const side of['base','head'])for(const row of report[side].file_coverage){
  const original=raw[side].file_coverage.find(r=>r.path===row.path),normalize=r=>{const {change_index,...rest}=r||{};return rest;};
  if(sha(normalize(row))!==sha(normalize(original)))fail('IMPACT_MULTISCOPE_VERIFICATION_CONTEXT_MISMATCH');
 }
}
export function aggregateScopedImplementationEvidence({source,expectedScopes,reports,auxiliary_scope_context,no_owned_changes_context,verification_input_context,purpose='admission_only'}){
  if(!['admission_only','main_verification'].includes(purpose))fail('IMPACT_MULTISCOPE_PURPOSE_INVALID');
  if(purpose==='main_verification'&&(source?.repo!=='perfectuser21/cecelia'||!supportedCeceliaScopes(expectedScopes)))fail('IMPACT_MULTISCOPE_MAIN_SOURCE_INVALID');
  if(!Array.isArray(expectedScopes)||!expectedScopes.length||new Set(expectedScopes).size!==expectedScopes.length||
    !Array.isArray(reports)||reports.length!==expectedScopes.length)fail('IMPACT_MULTISCOPE_SCOPES_REQUIRED');
  const normalized=validateImplementationImpact({scope:expectedScopes[0],repo:source?.repo,base_revision:source?.base_revision,head_revision:source?.head_revision,changed_files:source?.changed_files});
  const changes=normalized.changed_files,known=new Set(changes.map(key));
  if(known.size!==changes.length)fail('IMPACT_MULTISCOPE_DIFF_DUPLICATE');
  const context=verifyAuxiliaryScopeContext(source,expectedScopes,auxiliary_scope_context);
  const verification=verificationContext(source,verification_input_context?.source_reports,verification_input_context,purpose);
  const noOwned=verifyNoOwnedContext(source,expectedScopes,reports,no_owned_changes_context,context,purpose,verification);
  const seen=new Set(),claims=new Map(changes.map(c=>[key(c),[]]));
  for(const report of reports){
    if(purpose==='main_verification'&&(report.ci_context?.purpose!=='release'||report.head?.revision!==source.head_revision||!report.required_assertions?.length))fail('IMPACT_MULTISCOPE_MAIN_SOURCE_INVALID');
    if(!Array.isArray(report.gaps)||report.mapping_status==='unknown'&&!report.gaps.length||
      ['base','head'].some(side=>report[side]?.mapping_status==='unknown'))fail('IMPACT_MULTISCOPE_UNRESOLVED_UNKNOWN');
    if(!expectedScopes.includes(report?.scope_key)||seen.has(report.scope_key))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
    seen.add(report.scope_key);
    if(report.source?.repo!==source.repo||report.source.base_revision!==source.base_revision||report.source.head_revision!==source.head_revision)
      fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    // UNKNOWN、断言遗漏、source/图错误必须在各自领域内拒绝，不借另一个领域的PASS。
    if(noOwned?.scope_keys.includes(report.scope_key))assertJointNoOwnedImplementationReport(report);
    else assertImplementationReport(report);
    assertScopedAuxiliaryReport(report,context);
    assertScopedVerificationReport(report,verification);
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
  for(const joint of verification?.joint_files||[]){
    const change=changes.find(c=>c.path===joint.path);if(!change)fail('IMPACT_MULTISCOPE_DIFF_MISMATCH');
    const owners=joint.input_indexes.flatMap(i=>verification.authorized_inputs[i].owner_claims);
    claims.set(key(change),joint.non_executable?[{scope_key:null,coverage_kind:joint.resolution_kind,joint_kind:joint.joint_kind,non_executable:true,context_sha256:verification.context_sha256}]:[...new Set(owners.map(o=>o.scope_key))].map(scope_key=>({scope_key,coverage_kind:'verification_input',context_sha256:verification.context_sha256})));
  }
  if([...claims.values()].some(v=>!v.length))fail('IMPACT_MULTISCOPE_FILE_UNCLAIMED');
  const body={schema_version:2,evidence_kind:purpose==='main_verification'?'scoped_implementation_main':'scoped_implementation_admission',source:{repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:changes},
    purpose,scope_reports:structuredClone(reports),
    ...(context?{auxiliary_scope_context:context}:{}),
    ...(noOwned?{no_owned_changes_context:noOwned}:{}),
    ...(verification?{verification_input_context:verification}:{}),
    file_coverage:changes.map(c=>({...c,claims:claims.get(key(c))})),
    business_runtime_status:'not_evaluated'};
  return {...body,evidence_sha256:sha(body)};
}

export function verifyScopedImplementationGitSource(repoRoot,proof){
  const rebuilt=aggregateScopedImplementationEvidence({source:proof?.source,expectedScopes:(proof?.scope_reports||[]).map(r=>r.scope_key),reports:proof?.scope_reports,auxiliary_scope_context:proof?.auxiliary_scope_context,no_owned_changes_context:proof?.no_owned_changes_context,verification_input_context:proof?.verification_input_context,purpose:proof?.purpose});
  if(proof?.verification_input_context)verifyVerificationInputContext(repoRoot,{source:proof.source,reports:proof.verification_input_context.source_reports,context:proof.verification_input_context,purpose:proof.purpose});
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
function resolveReportParts({source,expectedScopes,reports,verification_input_context,purpose='admission_only'}){
  const resolutions=[],parts=[],owners=new Map();
  if(!Array.isArray(reports)||!Array.isArray(expectedScopes)||reports.length!==expectedScopes.length)fail('IMPACT_MULTISCOPE_SCOPES_REQUIRED');
  const context=auxiliaryScopeContext(source,expectedScopes,reports);
  const verification=verificationContext(source,reports,verification_input_context,purpose);
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
    const indexes=source.changed_files.flatMap((change,index)=>!context?.joint_files.some(f=>f.path===change.path)&&!verification?.joint_files.some(f=>f.path===change.path)&&owners.get(key(change))?.includes(report.scope_key)?[index]:[]);
    if(!indexes.length)assertNoOwnedRawReports(source,expectedScopes,reports,context,purpose,verification);
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
      if(change&&verification?.joint_files.some(f=>f.path===change.path)){
        resolutions.push({scope_key:report.scope_key,path:change.path,coverage_kind:verification.joint_files.find(f=>f.path===change.path).resolution_kind,context_sha256:verification.context_sha256});continue;
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
    if(indexes.length)assertImplementationReport(part);else assertJointNoOwnedImplementationReport(part);
    parts.push(part);
  }
  return {parts,resolutions,context,verification};
}

export function resolveScopedImplementationReports({source,expectedScopes,reports,verification_input_context,purpose='admission_only'}){
  const {parts,resolutions,context,verification}=resolveReportParts({source,expectedScopes,reports,verification_input_context,purpose});
  const noOwned=buildNoOwnedContext(source,reports,parts,resolutions,purpose,verification);
  const proof=aggregateScopedImplementationEvidence({source,expectedScopes,reports:parts,auxiliary_scope_context:context,no_owned_changes_context:noOwned,verification_input_context:verification,purpose});
  const body={schema_version:1,evidence:proof,source_reports:structuredClone(reports),resolved_foreign_paths:resolutions};
  return {...body,resolution_sha256:sha(body)};
}


function assertNoOwnedBoundary(source,scopes,purpose){
  if(source?.repo!=='perfectuser21/cecelia'||!supportedCeceliaScopes(scopes)||
    !['admission_only','main_verification'].includes(purpose))fail('IMPACT_MULTISCOPE_NO_OWNED_SOURCE_INVALID');
}
function assertNoOwnedRawReports(source,scopes,reports,context,purpose,verification){
  assertNoOwnedBoundary(source,scopes,purpose);
  if(JSON.stringify(reports.map(r=>r.scope_key))!==JSON.stringify(scopes))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
  for(const report of reports){
    if(report.ci_context?.purpose!==(purpose==='main_verification'?'release':'admission_only')||
      !['base','head'].every(side=>/^[0-9a-f]{64}$/.test(report.ci_context?.[`${side}_snapshot_sha256`]||'')))
      fail('IMPACT_MULTISCOPE_NO_OWNED_SOURCE_INVALID');
    for(const side of ['base','head']){
      const files=report[side]?.file_coverage;
      if(report[side]?.mapping_status!=='verified'||!Array.isArray(files)||files.length!==source.changed_files.length)
        fail('IMPACT_MULTISCOPE_NO_OWNED_SOURCE_INVALID');
      for(const [index,change] of source.changed_files.entries()){
        const file=files[index];
        if(file?.change_index!==index||file.path!==(side==='base'?change.old_path||change.path:change.path)||
          !Array.isArray(file.matched_paths)||file.truncated!==false)fail('IMPACT_MULTISCOPE_NO_OWNED_SOURCE_INVALID');
      }
    }
    for(const [index,change] of source.changed_files.entries()){
      const pair=['base','head'].map(side=>report[side].file_coverage[index]);
      if(pair.some(f=>f.matched_paths.length)||pair.every(f=>f.coverage_kind==='governance')||context?.joint_files.some(f=>f.path===change.path)||verification?.joint_files.some(f=>f.path===change.path))continue;
      if(!report.gaps.some(g=>g.code==='changed_file_unclaimed'&&!g.side&&g.path===change.path&&(g.old_path??null)===(change.old_path??null))||
        !report.unclaimed_paths?.some(f=>key(f)===key(change)))fail('IMPACT_MULTISCOPE_NO_OWNED_SOURCE_INVALID');
    }
  }
}
function buildNoOwnedContext(source,reports,parts,resolutions,purpose,verification){
  const scope_keys=parts.filter(r=>!r.source.changed_files.length).map(r=>r.scope_key);
  if(!scope_keys.length)return null;
  const body={schema_version:1,source:structuredClone(source),purpose,scope_keys,
    source_reports:structuredClone(reports),source_report_hashes:reports.map(r=>({scope_key:r.scope_key,report_sha256:sha(r)})),
    resolved_foreign_paths:structuredClone(resolutions),...(verification?{verification_input_context_sha256:verification.context_sha256}:{})};
  return {...body,context_sha256:sha(body)};
}
/** 空切片只能由完整原始报告重新推导；外层标志/自填hash不能免除任一scope。 */
function verifyNoOwnedContext(source,scopes,reports,context,auxiliary,purpose,verification){
  const empty=reports.some(r=>Array.isArray(r?.source?.changed_files)&&!r.source.changed_files.length);
  if(!empty&&!context)return null;
  assertNoOwnedBoundary(source,scopes,purpose);
  if(!empty||!context)fail('IMPACT_MULTISCOPE_NO_OWNED_CONTEXT_MISMATCH');
  const rebuilt=resolveReportParts({source,expectedScopes:scopes,reports:context.source_reports,verification_input_context:verification,purpose});
  const expected=buildNoOwnedContext(source,context.source_reports,rebuilt.parts,rebuilt.resolutions,purpose,verification);
  if(!expected||sha(expected)!==sha(context)||sha(rebuilt.parts)!==sha(reports)||sha(rebuilt.context)!==sha(auxiliary))
    fail('IMPACT_MULTISCOPE_NO_OWNED_CONTEXT_MISMATCH');
  return expected;
}

export async function runScopedImplementationGate({repoRoot,evidence,timeoutMs=300000,verificationDb,verificationToolingRoot,verificationToolingRevision}){
  verifyScopedImplementationGitSource(repoRoot,evidence);
  const verifyDerived=async()=>{if(evidence.verification_input_context)await verifyVerificationInputContextAuthority(repoRoot,{source:evidence.source,context:evidence.verification_input_context,reports:evidence.verification_input_context.source_reports,db:verificationDb,toolingRoot:verificationToolingRoot,toolingRevision:verificationToolingRevision});};
  await verifyDerived();
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
      purpose:evidence.purpose,business_runtime_status:'not_evaluated',
      ...(evidence.no_owned_changes_context?.scope_keys.includes(report.scope_key)?{ownership_status:'no_owned_changes',
        no_owned_context_sha256:evidence.no_owned_changes_context.context_sha256}: {})});
  }
  verifyScopedImplementationGitSource(repoRoot,evidence);
  await verifyDerived();
  return {schema_version:2,actor:'implementation_ci_gate',evidence_kind:evidence.evidence_kind,source:evidence.source,
    evidence_sha256:evidence.evidence_sha256,scope_receipts:receipts,purpose:evidence.purpose,
    ...(evidence.auxiliary_scope_context?{auxiliary_scope_receipt:{schema_version:1,purpose:evidence.purpose,
      context_sha256:evidence.auxiliary_scope_context.context_sha256,owner_claims:evidence.auxiliary_scope_context.owner_claims,
      joint_files:evidence.auxiliary_scope_context.joint_files,verdict:'PASS',business_runtime_status:'not_evaluated'}}:{}),
    ...(evidence.verification_input_context?{verification_input_receipt:{schema_version:1,purpose:'admission_only',context_sha256:evidence.verification_input_context.context_sha256,joint_files:evidence.verification_input_context.joint_files,execution_status:'not_evaluated',coverage:'unknown'}}:{}),
    verdict:receipts.every(r=>r.verdict==='PASS')?'PASS':'FAIL',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString()};
}
