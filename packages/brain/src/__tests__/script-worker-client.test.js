import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {createScriptWorkerClient} from '../script-worker-client.js';
const machine='us-mac-m4',token='fixture-script-worker-auth-'.repeat(3);
const body={reservation_id:'11111111-1111-4111-8111-111111111111',owner_key:'script-t-a1',intent_id:'i',launch_generation:1,config_digest:'a'.repeat(64)};
function client(change) {
  return createScriptWorkerClient({authorizeRequest:async(_m,_a,_b,run)=>run('http://127.0.0.1:1'),token,fetchFn:async(_url,request)=>{
    const sent=JSON.parse(request.body);
    const receipt={...sent,machine_id:machine,status:'cleaned',absent:true,tombstoned:true};
    const envelope={receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')};
    change?.(envelope);
    return new Response(JSON.stringify(envelope),{status:200});
  }});
}
describe('认证脚本worker客户端',()=>{
  it('只有匹配新nonce和完整签名才产生认证封套',async()=>{
    await expect(client().cancel(machine,body)).resolves.toMatchObject({authenticated:true,receipt:{status:'cleaned'}});
  });
  it.each(['signature','nonce','machine','identity'])('拒绝篡改或重放 %s',async(kind)=>{
    const invalid=client((value)=>{
      if(kind==='signature')value.signature='0'.repeat(64);
      else {
        if(kind==='nonce')value.receipt.request_nonce='old';
        if(kind==='machine')value.receipt.machine_id='xian-mac-m4';
        if(kind==='identity')value.receipt.intent_id='other';
        value.signature=createHmac('sha256',token).update(JSON.stringify(value.receipt)).digest('hex');
      }
    });
    await expect(invalid.cancel(machine,body)).rejects.toThrow();
  });
  it.each([404,503])('HTTP%s缺失/故障不能作为清理证明',async(status)=>{
    const invalid=createScriptWorkerClient({authorizeRequest:async(_m,_a,_b,run)=>run('http://127.0.0.1:1'),token,fetchFn:async()=>new Response('{}',{status})});
    await expect(invalid.cancel(machine,body)).rejects.toThrow(`http_${status}`);
  });
});
