import {execFileSync} from 'node:child_process';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
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
