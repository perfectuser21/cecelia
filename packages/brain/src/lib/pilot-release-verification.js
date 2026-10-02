/** 完整已声明试点回归计划；与变更影响报告分离，不声称全仓覆盖或业务执行。 */
import {createHash} from 'node:crypto';
import {canonicalAssertionCommandText} from './gp-assertion-command.js';
import {assertionDigest} from './journey-assertion-receipt.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const pilotPlanHash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const same=(a,b)=>pilotPlanHash(a)===pilotPlanHash(b);
const sorted=rows=>rows.sort((a,b)=>JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export function pilotPlanBody(report){
 return Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]]));
}
export function buildPilotReleasePlan({scope,repo,revision,definitions,assertions}){
 const gaps=[],expected_usages=[],groups=new Map();
 const gap=(code,detail={})=>gaps.push({code,...detail});
 if(typeof scope!=='string'||!scope||typeof repo!=='string'||!repo.includes('/')||!sha(revision))gap('pilot_source_invalid');
 const definition_versions={};
 for(const kind of ['workflows','activities']){
  const rows=definitions?.[kind]||[],identity=kind==='workflows'?'workflow_id':'activity_id';
  if(!rows.length||new Set(rows.map(r=>r.id)).size!==rows.length)gap('pilot_definition_missing',{kind});
  definition_versions[kind]=sorted(rows.map(r=>{
   if(!uuid(r.id)||!uuid(r[identity])||r.source_repo!==repo||r.source_commit!==revision||!hash(r.payload_sha256))gap('pilot_definition_source_invalid',{id:r.id});
   return Object.fromEntries(['id',identity,'payload_sha256','source_repo','source_commit'].map(k=>[k,r[k]]));
  }));
 }
 for(const w of definitions?.workflows||[]){
  if(!uuid(w.payload?.capability_id)||!Array.isArray(w.payload?.activities)||!w.payload.activities.length){gap('pilot_workflow_identity_missing',{id:w.id});continue;}
  for(const ref of w.payload.activities){
   const a=definitions.activities.find(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id);
   if(!a||!uuid(ref.reference_id)){gap('pilot_activity_reference_missing',{workflow_definition_version_id:w.id,reference_id:ref.reference_id});continue;}
   const base={workflow_id:w.workflow_id,workflow_definition_version_id:w.id,reference_id:ref.reference_id,capability_id:w.payload.capability_id,activity_id:a.activity_id,activity_definition_version_id:a.id};
   expected_usages.push({...base,step_id:null});
   if(!Array.isArray(a.payload.steps)||!a.payload.steps.length)gap('pilot_step_coverage_unknown',{activity_id:a.activity_id});
   for(const step of a.payload.steps||[])if(!uuid(step.step_id)||step.locator?.activity_id!==a.activity_id)gap('pilot_step_identity_missing',{activity_id:a.activity_id,step_key:step.locator?.step_key});else expected_usages.push({...base,step_id:step.step_id});
  }
 }
 sorted(expected_usages);
 const pair=u=>JSON.stringify([u.capability_id,u.activity_id,u.step_id||null]),covered=new Set();
 for(const row of assertions||[]){
  const matches=expected_usages.filter(u=>u.capability_id===row.journey_id&&u.activity_id===row.step_id&&u.step_id===(row.step_id_ref||null));
  if(!matches.length)continue;
  try{canonicalAssertionCommandText(row.assertion_ref);}catch{gap('pilot_assertion_invalid',{journey_step_link_id:row.id});continue;}
  const group=groups.get(row.assertion_ref)||{assertion_ref:row.assertion_ref,source_repo:repo,source_repo_basis:'activity_definition',source_bindings:[]};
  group.source_bindings.push({assertion_source:'current_registration',source_repo:repo,source_repo_basis:'activity_definition',capability_id:row.journey_id,activity_id:row.step_id,step_id:row.step_id_ref||null,journey_step_link_id:row.id,assertion_revision:row.assertion_revision,assertion_digest:assertionDigest(row.assertion_ref)});
  groups.set(row.assertion_ref,group);for(const u of matches)covered.add(pair(u));
 }
 for(const u of expected_usages)if(!covered.has(pair(u)))gap('pilot_regression_missing',u);
 const required_assertions=sorted([...groups.values()].map(g=>({...g,source_bindings:sorted(g.source_bindings)})));
 if(!required_assertions.length)gap('pilot_regressions_empty');
 const plan={scope,source:{repo,head_revision:revision},definition_versions,expected_usages,required_assertions,assertion_source:'current_registration'};
 return {schema_version:1,protocol:'pilot_release_verification_v1',purpose:'release_verification',...plan,assertion_plan_sha256:pilotPlanHash(plan),verification_status:gaps.length?'unknown':'verified',gaps};
}
export function assertPilotReleaseReport(report){
 const fail=()=>{throw Object.assign(Error('完整试点发布回归证据不满足要求'),{code:'PILOT_RELEASE_UNVERIFIED'});};
 if(report?.protocol!=='pilot_release_verification_v1'||report.purpose!=='release_verification'||report.verification_status!=='verified'||!Array.isArray(report.gaps)||report.gaps.length||!hash(report.snapshot_sha256)||!same(pilotPlanHash(pilotPlanBody(report)),report.assertion_plan_sha256)||!report.expected_usages?.length||!report.required_assertions?.length)fail();
 for(const u of report.expected_usages)if(!report.required_assertions.some(a=>a.source_repo===report.source.repo&&a.source_bindings?.some(b=>b.capability_id===u.capability_id&&b.activity_id===u.activity_id&&(b.step_id||null)===u.step_id)))fail();
 return report;
}
export async function validatePilotReleaseEvidence(db,report,receipt,definitions){
 assertPilotReleaseReport(report);
 const caps=[...new Set(definitions.workflows.map(w=>w.payload.capability_id))],activities=definitions.activities.map(a=>a.activity_id);
 const rows=(await db.query('SELECT id,journey_id,step_id,step_id_ref,assertion_ref,assertion_revision FROM journey_step_links WHERE journey_id=ANY($1::uuid[]) AND step_id=ANY($2::uuid[]) ORDER BY id',[caps,activities])).rows;
 const expected=buildPilotReleasePlan({scope:report.scope,repo:report.source.repo,revision:report.source.head_revision,definitions,assertions:rows});
 const fail=()=>{throw Object.assign(Error('固定完整计划与当前登记或执行收据不符'),{code:'PILOT_RELEASE_PLAN_MISMATCH'});};
 if(expected.verification_status!=='verified'||!same(pilotPlanBody(expected),pilotPlanBody(report)))fail();
 if(receipt?.purpose!=='release_verification'||receipt.actor!=='pilot_release_verification'||receipt.scope!=='declared_pilot_regressions'||receipt.verdict!=='PASS'||receipt.business_runtime_status!=='not_evaluated'||!same(receipt.source,report.source)||receipt.snapshot_sha256!==report.snapshot_sha256||receipt.assertion_plan_sha256!==report.assertion_plan_sha256||receipt.report_sha256!==createHash('sha256').update(JSON.stringify(report)).digest('hex'))fail();
 if(!Array.isArray(receipt.assertions)||receipt.assertions.length!==report.required_assertions.length||new Set(receipt.assertions.map(a=>a.assertion_ref)).size!==receipt.assertions.length)fail();
 for(const a of report.required_assertions)if(!receipt.assertions.some(r=>r.assertion_ref===a.assertion_ref&&r.source_repo===report.source.repo&&r.source_revision===report.source.head_revision&&same(r.source_bindings,a.source_bindings)&&r.exit_code===0&&!r.error&&!r.signal&&hash(r.test_sha256)))fail();
 return {...pilotPlanBody(report),assertion_plan_sha256:report.assertion_plan_sha256,snapshot_sha256:report.snapshot_sha256};
}
