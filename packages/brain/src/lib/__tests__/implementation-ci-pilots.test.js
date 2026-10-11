import { expect,it } from 'vitest';
const {buildPilotManifest}=await import('../../../../../scripts/map/register-capability-pilots.mjs').catch(()=>({}));
it('手机试点保旧三UUID并纳入真实内容生产/发布；公司KR原经营节奏父级不变',()=>{
  expect(buildPilotManifest).toBeTypeOf('function');
  const options={revision:'a'.repeat(40),decision:'11111111-1111-4111-8111-111111111111'};
  const phones=buildPilotManifest('phones',options);
  expect(phones.capabilities.map(c=>c.brain_binding.entity_id)).toEqual(['a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','24987ee5-53a0-4c37-946f-1b749954cac7']);
  expect(phones.value_streams.map(v=>v.key)).toEqual(['acquisition','content_production']);
  expect(phones.value_streams[1]).toMatchObject({key:'content_production',brain_binding:{entity_id:'1489c4e5-7806-4152-a091-b7d32e202ce7',entity_type:'value_stream',source_repo:'perfectuser21/zenithjoy-workspace',source_revision:options.revision}});
  expect(phones.capabilities[2]).toMatchObject({key:'android_worker_publish',value_stream_key:'content_production',brain_binding:{entity_type:'capability',source_repo:'perfectuser21/zenithjoy-workspace',source_revision:options.revision}});
  expect(phones.capabilities[2]).not.toHaveProperty('canonical_code');
  expect(phones.value_streams[0].brain_binding.entity_id).toBe('afa6abca-53c0-4815-8594-b7fb81ca547f');
  const kr=buildPilotManifest('company-kr',options);
  expect(kr.scope_key).toBe('cecelia-kr');expect(kr.capabilities).toHaveLength(1);
  expect(kr.capabilities[0].brain_binding.entity_id).toBe('dddddddd-f0f0-4000-8000-000000000004');
  expect(kr.value_streams[0].brain_binding.entity_id).toBe('c5cb480f-f7f7-4b4e-8871-bd65ff65b668');
  expect(kr.value_streams[0].name).toBe('经营节奏');
});
