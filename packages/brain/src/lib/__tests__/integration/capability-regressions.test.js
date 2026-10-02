import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
const module=await import('../../capability-regressions.js').catch(()=>({}));
let f;
beforeEach(async()=>{expect(module.registerCapabilityRegression).toBeTypeOf('function');f=await releaseEvidenceDatabase();});
afterEach(async()=>{await f?.close();f=null;});
it('共享Activity按真实消费者各登记一条断言且重放幂等，不强行改owner或置绿',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const one=await module.registerCapabilityRegression(f.db,input),replay=await module.registerCapabilityRegression(f.db,input);
  const other=await module.registerCapabilityRegression(f.db,{...input,capability_id:f.capabilities[1]});
  expect(one.registration.id).toBe(replay.registration.id);expect(one.registration.id).not.toBe(other.registration.id);
  expect(one.registration).toMatchObject({cell_status:'gray',status:'planned',step_id_ref:null,cell_level:'activity'});
});
it('规范Step断言单独登记；错Activity/Capability归属及不可执行ref拒绝且不留半条',async()=>{
  const activity=f.activities[0],step=activity.payload.steps[0].step_id;
  const cap=f.workflows.find(w=>w.payload.activities.some(r=>r.activity_id===activity.activity_id)).payload.capability_id;
  const input={capability_id:cap,activity_id:activity.activity_id,step_id:step,assertion_ref:'scripts/smoke/regression.sh'};
  const result=await module.registerCapabilityRegression(f.db,input);expect(result.registration).toMatchObject({step_id_ref:step,cell_level:'step'});
  const before=Number((await f.db.query('SELECT count(*) FROM journey_step_links')).rows[0].count);
  for(const bad of [{...input,capability_id:f.ids.valueStream},{...input,activity_id:f.activities.find(a=>a.activity_id!==activity.activity_id).activity_id},{...input,assertion_ref:'manual:bash scripts/smoke/regression.sh;curl bad'}]){
    await expect(module.registerCapabilityRegression(f.db,bad)).rejects.toThrow();
  }
  expect(Number((await f.db.query('SELECT count(*) FROM journey_step_links')).rows[0].count)).toBe(before);
});
it('已有断言的不同新内容必须显式匹配旧值，防并发覆盖已维护登记',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  await module.registerCapabilityRegression(f.db,input);
  await expect(module.registerCapabilityRegression(f.db,{...input,assertion_ref:'scripts/smoke/replacement.sh'})).rejects.toMatchObject({status:409});
  const changed=await module.registerCapabilityRegression(f.db,{...input,assertion_ref:'scripts/smoke/replacement.sh',expected_assertion_ref:input.assertion_ref});
  expect(changed.registration.assertion_ref).toBe('scripts/smoke/replacement.sh');expect(changed.registration.cell_status).toBe('gray');
});
it('幂等登记不清除其它评价者已有状态，但本次登记明确未执行验证',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const first=await module.registerCapabilityRegression(f.db,input);
  await f.db.query("UPDATE journey_step_links SET cell_status='green' WHERE id=$1",[first.registration.id]);
  const replay=await module.registerCapabilityRegression(f.db,input);
  expect(replay).toMatchObject({created:false,verification_status:'not_evaluated',registration:{cell_status:'green'}});
  expect((await f.db.query('SELECT cell_status FROM journey_step_links WHERE id=$1',[first.registration.id])).rows[0].cell_status).toBe('green');
});
it('同一UUID不同大小写不能产生第二份回归登记',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const first=await module.registerCapabilityRegression(f.db,input);
  const second=await module.registerCapabilityRegression(f.db,{...input,capability_id:input.capability_id.toUpperCase(),activity_id:input.activity_id.toUpperCase()});
  expect(second.registration.id).toBe(first.registration.id);expect(second.created).toBe(false);
});
