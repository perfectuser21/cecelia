import {afterEach,beforeEach,expect,it} from 'vitest';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {releaseEvidenceDatabase,RELEASE_HEAD} from '../../../__tests__/fixtures/release-evidence-db.js';
import {createRelease,getRelease,recordReleaseObservation,getReleaseGate} from '../../release-index.js';
let f,service;
beforeEach(async()=>{expect(existsSync(new URL('../../pilot-release-verification.js',import.meta.url)),'必须有独立完整试点发布验证').toBe(true);service=await import('../../pilot-release-verification.js');f=await releaseEvidenceDatabase();});
afterEach(async()=>{await f?.close();f=null;});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function plan(){return service.buildPilotReleasePlan({scope:'phones',repo:f.releaseInput.components[0].repo,revision:RELEASE_HEAD,definitions:{workflows:f.workflows,activities:f.activities},assertions:(await f.db.query('SELECT * FROM journey_step_links ORDER BY id')).rows});}
async function cover(){
 for(const w of f.workflows)for(const ref of w.payload.activities){const a=f.activities.find(a=>a.id===ref.activity_version_id);
  for(const step of [null,...a.payload.steps.map(s=>s.step_id)])await f.db.query(`INSERT INTO journey_step_links(journey_id,step_id,step_id_ref,step_order,assertion_ref) VALUES($1,$2,$3,1,'scripts/smoke/lock.sh')`,[w.payload.capability_id,a.activity_id,step]);
 }
}
function evidence(report){report={...report,snapshot_sha256:'d'.repeat(64)};return {report,receipt:{schema_version:1,purpose:'release_verification',actor:'pilot_release_verification',scope:'declared_pilot_regressions',source:report.source,snapshot_sha256:report.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:hash(report),verdict:'PASS',business_runtime_status:'not_evaluated',assertions:report.required_assertions.map(a=>({...a,source_revision:RELEASE_HEAD,test_sha256:'f'.repeat(64),exit_code:0,error:null,signal:null}))},evidence_ref:'fixture:pilot-release'};}
it('全部Activity与canonicalStep必须逐使用位置覆盖，Activity测试不能冒充Step',async()=>{
 const p=await plan();expect(p.verification_status).toBe('unknown');
 const missing=p.gaps.filter(g=>g.code==='pilot_regression_missing');expect(missing.some(g=>g.step_id)).toBe(true);
 expect(p.expected_usages.length).toBeGreaterThan(f.activities.length);
 await cover();const full=await plan();expect(full.verification_status).toBe('verified');expect(full.required_assertions.length).toBeGreaterThan(0);
});
it('真实首次release冻结完整计划，人改断言后历史读与同payload重放不漂移',async()=>{
 await cover();const p=await plan(),input={...f.releaseInput,ci_evidence:[evidence(p)]};
 const {release}=await createRelease(f.db,input);expect(release.payload.verification.ci_status).toBe('verified');
 expect(release.payload.assertion_plans[0]).toMatchObject({assertion_plan_sha256:p.assertion_plan_sha256,expected_usages:p.expected_usages});
 await f.db.query("UPDATE journey_step_links SET assertion_ref='scripts/smoke/changed.sh'");
 expect((await getRelease(f.db,release.id)).payload.assertion_plans).toEqual(release.payload.assertion_plans);
 expect((await createRelease(f.db,input)).release.id).toBe(release.id);
 const next=await createRelease(f.db,{...input,release_key:'new-after-registration-change'});expect(next.release.payload.verification.ci_status).toBe('unknown');
});
it('漏Step/漏登记断言、重复回执、PR purpose以及篡改计划均不能发布绿',async()=>{
 await cover();const p=await plan();
 for(const [i,mutate] of [e=>e.report.expected_usages.pop(),e=>e.report.required_assertions.pop(),e=>e.receipt.assertions=[e.receipt.assertions[0],e.receipt.assertions[0]],e=>e.receipt.purpose='admission_only',e=>e.report.assertion_plan_sha256='0'.repeat(64)].entries()){
  const e=evidence(p);mutate(e);e.receipt.report_sha256=hash(e.report);
  const r=await createRelease(f.db,{...f.releaseInput,release_key:`bad-${i}`,ci_evidence:[e]});expect(r.release.payload.verification.ci_status).toBe('unknown');
 }
});
