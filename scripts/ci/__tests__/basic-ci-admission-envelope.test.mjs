import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepSha256 as hash} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {validateImplementationSnapshot} from '../../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {createCiAdmissionEnvelope,authorizeCiAdmissionEnvelope,withCiAdmissionScratch,inspectCiAdmission} from '../ci-admission-envelope.mjs';
import * as codec from '../ci-admission-envelope.mjs';
import {verifyCiAdmissionAuthority} from '../ci-admission-authority.mjs';
import {attachCiArchive} from './fixtures/ci-admission-archive.mjs';
import {admissionFixture as fixture} from './fixtures/ci-admission-envelope.mjs';
const scopes=['cecelia-kr','cecelia-factory','cecelia-infra'];
const db={query:async()=>({rows:[{database:'cecelia_scratch',schema:'ci_admission_123456781234412381231234567890ab'}]})};
test('三scope为CI typed namespace，裸内层/删tag/重hash均不满足legacy schema',async t=>{
 const f=await fixture(t);assert.throws(()=>validateImplementationSnapshot(f.body));
 for(const s of f.body.ci_scopes){assert.throws(()=>validateImplementationSnapshot(s));assert.throws(()=>validateImplementationSnapshot(s.ci_document));}
 const cap=await f.open();assert.deepEqual(inspectCiAdmission(cap).scopes,scopes);assert.equal(JSON.stringify(cap),'{}');
 const result=await withCiAdmissionScratch(cap,{db,usage:'pr'},views=>{
  assert.deepEqual(views.map(s=>s.scope),scopes);views.forEach(validateImplementationSnapshot);
  assert.equal(views[1].execution_status,'unknown');return {imported:3};
 });assert.deepEqual(result,{imported:3});
});
for(const kind of ['outer-purpose','inner-format','bare-inner','outer-extra','inner-extra','scope-order','seed','missing-assertion','extra-assertion','failed-assertion','argv','source','forged-capability'])test('原envelope必须完整且按control seed全分母验证：'+kind,async t=>{
 const f=await fixture(t),body=structuredClone(f.body);
 if(kind==='outer-purpose')delete body.ci_purpose;
 if(kind==='inner-format')delete body.ci_scopes[1].ci_scope_format;
 if(kind==='bare-inner')body.ci_scopes[1]=f.snapshots[1];
 if(kind==='outer-extra')body.snapshot=f.snapshots[0];
 if(kind==='inner-extra')body.ci_scopes[0].snapshot=f.snapshots[0];
 if(kind==='scope-order')body.ci_scopes.reverse();
 if(kind==='seed')body.ci_seed_sha256='0'.repeat(64);
 if(kind==='missing-assertion')body.ci_assertions.executions.pop();
 if(kind==='extra-assertion')body.ci_assertions.executions.push({...body.ci_assertions.executions[0],registered_ids:['extra']});
 if(kind==='failed-assertion')body.ci_assertions.executions[0].exit_code=1;
 if(kind==='argv')body.ci_assertions.executions[0].command_argv=['echo','PASS'];
 if(kind==='source')body.ci_source_revision=f.control;
 const {ci_envelope_sha256,...raw}=body;body.ci_envelope_sha256=hash(raw);
 await assert.rejects(async()=>{
  const official=attachCiArchive(f,body),authority=kind==='forged-capability'?{}:await verifyCiAdmissionAuthority(official.options,official.deps);
  await authorizeCiAdmissionEnvelope(body,{authority,controlRoot:f.root});
 },/CI_ADMISSION_/);
});
for(const usage of ['main','release','recovery','live',undefined])test('非PR/编译用途在DB/HTTP/执行前拒绝：'+usage,async t=>{
 const f=await fixture(t),cap=await f.open();let effects=0;
 await assert.rejects(withCiAdmissionScratch(cap,{db:{query:async()=>{effects++;}},usage},()=>{effects++;}),/CI_ADMISSION_USAGE/);
 assert.equal(effects,0);
});
test('原envelope在授权后被替换/删字段仍拒绝，不返回可落盘的legacy视图',async t=>{
 const f=await fixture(t),cap=await f.open();
 await assert.rejects(withCiAdmissionScratch(cap,{db,usage:'pr'},views=>views),/CI_ADMISSION_LEGACY_ESCAPE/);
 delete f.body.ci_purpose;let effects=0;
 await assert.rejects(withCiAdmissionScratch(cap,{db,usage:'pr'},()=>{effects++;}),/CI_ADMISSION_/);assert.equal(effects,0);
});
test('生产DB或public schema不能获得转换能力',async t=>{
 const f=await fixture(t),cap=await f.open();
 for(const row of [{database:'cecelia',schema:'ci_admission_123456781234412381231234567890ab'},{database:'cecelia_scratch',schema:'public'}]){
  let effects=0;await assert.rejects(withCiAdmissionScratch(cap,{db:{query:async()=>({rows:[row]})},usage:'pr'},()=>{effects++;}),/CI_ADMISSION_SCRATCH/);assert.equal(effects,0);
 }
});
test('core仍合法的KR身份删减不能绕过control canonical全集',async t=>{
 const f=await fixture(t),snapshots=structuredClone(f.snapshots);snapshots[0].canonical.workflows=[];
 const {snapshot_sha256,...body}=snapshots[0];snapshots[0]={...body,snapshot_sha256:hash(body)};
 validateImplementationSnapshot(snapshots[0]);
 await assert.rejects(createCiAdmissionEnvelope({authority:f.authority,controlRoot:f.root,snapshots,executions:f.executions,sourceTree:f.git('rev-parse',`${f.source}^{tree}`)}),/CI_ADMISSION_CANONICAL/);
});
test('scratch legacy内存视图冻结，不能被调用方就地升级执行状态',async t=>{
 const f=await fixture(t),cap=await f.open();
 await withCiAdmissionScratch(cap,{db,usage:'pr'},views=>{assert.throws(()=>{views[1].execution_status='verified';},TypeError);return {checked:true};});
});
test('离线worker只交非legacy draft，外层真实authority复核后才可成为官方封套',async t=>{
 const f=await fixture(t),sourceTree=f.git('rev-parse',`${f.source}^{tree}`);
 const draft=await codec.createCiAdmissionDraft({controlRoot:f.root,controlRevision:f.control,sourceRevision:f.source,sourceTree,snapshots:f.snapshots,executions:f.executions});
 assert.throws(()=>validateImplementationSnapshot(draft));
 await assert.rejects(authorizeCiAdmissionEnvelope(draft,{authority:f.authority,controlRoot:f.root}),/CI_ADMISSION_/);
 const final=await createCiAdmissionEnvelope({authority:f.authority,controlRoot:f.root,draft});
 assert.equal(final.ci_purpose,'ci_admission_only');await authorizeCiAdmissionEnvelope(final,{authority:f.authority,controlRoot:f.root});
 draft.ci_source_revision=f.control;
 await assert.rejects(createCiAdmissionEnvelope({authority:f.authority,controlRoot:f.root,draft}),/CI_ADMISSION_/);
});
test('仅有官方CI/run身份不能给自报JSON发消费能力，必须核官方artifact原ZIP',async t=>{
 const f=await fixture(t),bare=await verifyCiAdmissionAuthority(f.options,{api:f.api});
 await assert.rejects(authorizeCiAdmissionEnvelope(f.body,{authority:bare,controlRoot:f.root}),/CI_ADMISSION_ARTIFACT_BOUND/);
});
test('没有assertion_ref的UNKNOWN格同样不得从CI登记全集删除',async t=>{
 const f=await fixture(t),snapshots=structuredClone(f.snapshots);snapshots[0].assertions=snapshots[0].assertions.filter(a=>a.assertion_ref);
 const {snapshot_sha256,...body}=snapshots[0];snapshots[0]={...body,snapshot_sha256:hash(body)};
 validateImplementationSnapshot(snapshots[0]);
 await assert.rejects(createCiAdmissionEnvelope({authority:f.authority,controlRoot:f.root,snapshots,executions:f.executions,sourceTree:f.git('rev-parse',`${f.source}^{tree}`)}),/CI_ADMISSION_ASSERTION_REGISTRY/);
});
