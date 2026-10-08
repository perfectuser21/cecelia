import { expect,it } from 'vitest';
const {buildPilotManifest}=await import('../../../../../scripts/map/register-capability-pilots.mjs').catch(()=>({}));
it('手机试点复用已核三UUID；公司KR保留人工调整后的G5经营节奏父级',()=>{
  expect(buildPilotManifest).toBeTypeOf('function');
  const options={revision:'a'.repeat(40),decision:'11111111-1111-4111-8111-111111111111'};
  const phones=buildPilotManifest('phones',options);
  expect(phones.capabilities.map(c=>c.brain_binding.entity_id)).toEqual(['a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002']);
  expect(phones.value_streams[0].brain_binding.entity_id).toBe('afa6abca-53c0-4815-8594-b7fb81ca547f');
  const kr=buildPilotManifest('company-kr',options);
  expect(kr.scope_key).toBe('cecelia-kr');expect(kr.capabilities).toHaveLength(1);
  expect(kr.capabilities[0].brain_binding.entity_id).toBe('dddddddd-f0f0-4000-8000-000000000004');
  expect(kr.value_streams[0].brain_binding.entity_id).toBe('c5cb480f-f7f7-4b4e-8871-bd65ff65b668');
  expect(kr.value_streams[0].name).toBe('经营节奏');
});
