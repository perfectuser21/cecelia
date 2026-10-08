/** 回归：v3.0 每个 Activity 固定 8 格的骨架格 assertion_ref 为空＝未声明断言，不能被试点发布门禁记成 invalid（10-05 起 PILOT_RELEASE_UNVERIFIED）。 */
import {describe,expect,it} from 'vitest';
import {buildPilotReleasePlan} from '../pilot-release-verification.js';

const REPO='perfectuser21/zenithjoy-workspace',REV='a'.repeat(40),H='c'.repeat(64);
const CAP='a1000000-0000-4000-8000-000000000001',ACT='d27e18c9-709f-4c44-899c-85d6fb83671b',STEP='19ee1ee3-4b65-41d9-98d2-2f043e817e93';
const definitions={
 workflows:[{id:'0a7e2eeb-f70d-4062-af63-e9bf816c6006',workflow_id:'b1000000-0000-4000-8000-000000000001',payload_sha256:H,source_repo:REPO,source_commit:REV,
  payload:{capability_id:CAP,activities:[{activity_version_id:'3cce1812-113a-44ed-a666-3eae7f940b5b',activity_id:ACT,reference_id:'9eda2971-0b4d-4c6f-918b-80c1bff26bd6'}]}}],
 activities:[{id:'3cce1812-113a-44ed-a666-3eae7f940b5b',activity_id:ACT,payload_sha256:H,source_repo:REPO,source_commit:REV,
  payload:{steps:[{step_id:STEP,locator:{activity_id:ACT,step_key:'verify_device_identity'}}],
   implementation_bindings:[{scope:'activity',kind:'code',status:'verified',repo:REPO,revision:REV,path:'src/a.js',digest:'sha256:'+'e'.repeat(64)}]}}],
};
let n=0;
const cell=(step_id_ref,assertion_ref)=>({id:`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,journey_id:CAP,step_id:ACT,step_id_ref,assertion_ref,assertion_revision:'1'});
const SMOKE='.github/workflows/scripts/smoke/capability-phone-regression-smoke.sh';
const plan=assertions=>buildPilotReleasePlan({scope:'zenithjoy',repo:REPO,revision:REV,definitions,assertions});
const codes=p=>p.gaps.map(g=>g.code);

describe('试点发布门禁：空 assertion_ref 的骨架格', () => {
 it('Activity 级与 Step 级空格子（null / 空串）不算 invalid，真实回归覆盖后判 verified', () => {
  const p=plan([cell(null,SMOKE),cell(STEP,SMOKE),cell(null,null),cell(null,''),cell(STEP,null),cell(STEP,'')]);
  expect(codes(p)).toEqual([]);
  expect(p.verification_status).toBe('verified');
  expect(p.required_assertions).toHaveLength(1);
  expect(p.required_assertions[0].source_bindings).toHaveLength(2);
 });
 it('空格子不能冒充覆盖：只有空格子时仍报 pilot_regression_missing', () => {
  const p=plan([cell(null,null),cell(STEP,'')]);
  expect(codes(p)).not.toContain('pilot_assertion_invalid');
  expect(p.gaps.filter(g=>g.code==='pilot_regression_missing')).toHaveLength(2);
  expect(p.verification_status).toBe('unknown');
 });
 it('非空但解析失败的引用仍记 pilot_assertion_invalid', () => {
  const bad=cell(STEP,'manual:node --test services/x.test.mjs'),blank=cell(null,'   ');
  const p=plan([cell(null,SMOKE),cell(STEP,SMOKE),bad,blank]);
  expect(p.gaps).toEqual(expect.arrayContaining([{code:'pilot_assertion_invalid',journey_step_link_id:bad.id},{code:'pilot_assertion_invalid',journey_step_link_id:blank.id}]));
  expect(p.verification_status).toBe('unknown');
 });
});
