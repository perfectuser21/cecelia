/** 回归（e5ea8e45）：10-05 起 PILOT_RELEASE_UNVERIFIED——迁移 520/521 把 element/probe/八格骨架格带进试点快照、把对标获客 43 条回归登记改归属。
 * 门禁口径恢复为只认 CI 回归登记（scenario + regression:%），且不能因此变松。 */
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
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
const row=(cell_kind,cell_key,step_id_ref,assertion_ref)=>({id:`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,journey_id:CAP,step_id:ACT,step_id_ref,cell_kind,cell_key,assertion_ref,assertion_revision:'1'});
const reg=(step,ref)=>row('scenario',`regression:${CAP}:${step||'activity'}`,step,ref);
const SMOKE='.github/workflows/scripts/smoke/capability-phone-regression-smoke.sh';
const plan=assertions=>buildPilotReleasePlan({scope:'zenithjoy',repo:REPO,revision:REV,definitions,assertions});
const codes=p=>p.gaps.map(g=>g.code);
const missing=p=>p.gaps.filter(g=>g.code==='pilot_regression_missing');

describe('试点发布门禁只认 CI 回归登记', () => {
 it('非回归格（element 骨架空格、probe 探针、非 regression 键的 manual:node --test 场景格）不让门禁失败', () => {
  const p=plan([reg(null,SMOKE),reg(STEP,SMOKE),
   row('element','problem',null,null),row('element','stage:preflight',null,'probe:pf_device_verified'),row('element','step:x',STEP,''),
   row('scenario','commander-native-aftercare-full-list-intent',null,'manual:node --test services/x.test.mjs')]);
  expect(codes(p)).toEqual([]);
  expect(p.verification_status).toBe('verified');
  expect(p.required_assertions).toHaveLength(1);
  expect(p.required_assertions[0].source_bindings).toHaveLength(2);
 });
 it('非回归格不能冒充覆盖：即使引用合法，没有回归登记仍报 pilot_regression_missing', () => {
  const p=plan([row('element','stage:preflight',null,SMOKE),row('scenario','commander-x',STEP,SMOKE)]);
  expect(missing(p)).toHaveLength(2);
  expect(p.verification_status).toBe('unknown');
 });
 it('regression 行引用非法（manual:node --test、纯空白、probe:）照样记 pilot_assertion_invalid', () => {
  const bad=[reg(STEP,'manual:node --test services/x.test.mjs'),reg(null,'   '),row('scenario',`regression:${CAP}:other`,null,'probe:pool_advanced')];
  const p=plan([reg(null,SMOKE),reg(STEP,SMOKE),...bad]);
  expect(p.gaps.filter(g=>g.code==='pilot_assertion_invalid').map(g=>g.journey_step_link_id).sort()).toEqual(bad.map(b=>b.id).sort());
  expect(p.verification_status).toBe('unknown');
 });
 it('regression 行 assertion_ref 为空＝未声明，不当合格：对应用法报 pilot_regression_missing', () => {
  const p=plan([reg(null,null),reg(STEP,'')]);
  expect(codes(p)).not.toContain('pilot_assertion_invalid');
  expect(missing(p)).toHaveLength(2);
  expect(p.verification_status).toBe('unknown');
 });
 it('回归登记缺失照报 pilot_regression_missing', () => {
  const p=plan([reg(null,SMOKE)]);
  expect(missing(p)).toEqual([expect.objectContaining({capability_id:CAP,activity_id:ACT,step_id:STEP})]);
 });
});

describe('真实失败快照 275242df（zenithjoy-workspace run 37722987778）', () => {
 const snap=JSON.parse(readFileSync(new URL('../../__tests__/fixtures/pilot-release-snapshot-275242df.json',import.meta.url),'utf8'));
 const run=assertions=>buildPilotReleasePlan({scope:snap.scope,repo:snap.repo,revision:snap.revision,definitions:snap.definitions,assertions});
 const CAP02='a1000000-0000-4000-8000-000000000002';
 // 迁移 534 的效果：regression 格 journey_id 按 cell_key 归还消费者能力
 const after534=snap.assertions.map(a=>a.cell_kind==='scenario'&&a.cell_key?.startsWith('regression:')?{...a,journey_id:a.cell_key.split(':')[1]}:a);
 it('迁移 534 前：口径恢复后 invalid 清零，只剩对标获客 43 个真实缺口', () => {
  const p=run(snap.assertions);
  expect(codes(p)).not.toContain('pilot_assertion_invalid');
  expect(missing(p)).toHaveLength(43);
  expect(missing(p).every(g=>g.capability_id===CAP02)).toBe(true);
 });
 it('迁移 534 后：cap02 的 43 个期望用法全部覆盖，100 个期望用法全部 verified', () => {
  const p=run(after534);
  expect(p.gaps).toEqual([]);
  expect(p.verification_status).toBe('verified');
  expect(p.expected_usages).toHaveLength(100);
  expect(p.expected_usages.filter(u=>u.capability_id===CAP02)).toHaveLength(48);
 });
});
