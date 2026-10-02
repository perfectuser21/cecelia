import { randomUUID } from 'node:crypto';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
const service=await import('../../capability-system.js').catch(()=>({}));
let f;
beforeEach(async()=>{
  expect(service.readCapabilitySystem).toBeTypeOf('function');f=await releaseEvidenceDatabase();
  await f.db.query('CREATE TABLE journey_features (LIKE public.journey_features INCLUDING ALL)');
});
afterEach(async()=>{await f?.close();f=null;});
it('同一共享Activity两个引用位置只计一个真身，返回完整层级与规范UUID',async()=>{
  const r=await service.readCapabilitySystem(f.db);
  expect(r.counts.workflows.total).toBe(2);expect(r.counts.activities.total).toBe(9);expect(r.counts.activities.usage_count).toBe(16);
  const shared=r.activities.filter(a=>a.consumers.length===2);expect(shared).toHaveLength(7);
  expect(new Set(shared[0].consumers.map(c=>c.reference_id)).size).toBe(2);
  expect(r.journeys.filter(j=>j.role==='value_stream')).toHaveLength(1);expect(r.journeys.filter(j=>j.role==='capability')).toHaveLength(2);
  expect(r.workflows[0].activities.every(a=>a.usage.reference_id&&a.usage.activity_definition_version_id)).toBe(true);
});
it('未引用旧活动和无归属能力保持清单可见，不因Workflow内连接而消失',async()=>{
  const id=randomUUID();await f.db.query("INSERT INTO journey_steps(id,journey_id,name,step_number) VALUES($1,$2,'尚未归位',99)",[id,f.capabilities[0]]);
  await f.db.query('UPDATE journeys SET area_id=NULL');
  const r=await service.readCapabilitySystem(f.db);
  expect(r.counts.activities.total).toBe(10);expect(r.counts.activities.referenced).toBe(9);
  expect(r.activities.find(a=>a.id===id)).toMatchObject({contract_present:false,definition_status:'unknown',consumers:[]});
  expect(r.gaps).toContainEqual(expect.objectContaining({entity_type:'activity',entity_id:id,code:'workflow_reference_missing'}));
  expect(r.gaps).toContainEqual(expect.objectContaining({entity_type:'capability',code:'area_unknown'}));
});


it('实现绑定保留Activity或Step归属，并由固定定义解析规范Step身份',async()=>{
  const a=f.contracts.docs.keyword_acquisition.activities[0],step=a.steps[0];
  step.implementation_bindings=[{kind:'code',repo:'perfectuser21/zenithjoy-workspace',path:'src/step-only.js',revision:'b'.repeat(40)}];
  await f.sync('b'.repeat(40));
  const r=await service.readCapabilitySystem(f.db),activity=r.activities.find(x=>x.activity_key===a.key);
  const binding=activity.implementation_bindings.find(b=>b.path==='src/step-only.js');
  expect(binding).toMatchObject({scope:'step',step_key:step.key,step_id:expect.any(String),validation_scope:'reference_only'});
  expect(r.steps.some(s=>s.id===binding.step_id&&s.activity_id===activity.id)).toBe(true);
  expect(binding).not.toHaveProperty('raw');
});

