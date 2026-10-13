import { it, expect, vi } from 'vitest';
import { registerWorkflow, registrationDigest } from './registration.js';

it('冻结协议没有真实来源证明必须在SQL写入前拒绝',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const definition={key:'report',name:'报告',capability_id:id,channel:'internal',form:'code',version:'1.0.0',
    source:{repo:'perfectuser21/cecelia',ref:'contract.json',revision:'a'.repeat(40)},
    runtime:{skill_id:id,entrypoint:'commander'},activities:[{key:'read',name:'读回',executor_kind:'code',acceptance:['读回'],implementation:{kind:'code',ref:'file.js',version:'1.0.0'}}]};
  const client={query:vi.fn(async()=>({rows:[]}))};
  await expect(registerWorkflow(client,definition,{registrationProtocol:'definition-freeze-v1',definitionSha256:registrationDigest(definition)})).rejects.toMatchObject({code:'definition_freeze_proof_invalid'});
  expect(client.query).not.toHaveBeenCalled();
});
