import {it,expect} from 'vitest';
import {createHmac,randomUUID} from 'node:crypto';
import {createAppServerClient} from '../client.js';
import {workerIdentity} from '../identity.js';
it('Worker响应缺签名、重放nonce或HOME/boot不同均不得形成认证封套',async()=>{
 const token='a'.repeat(32),row={id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'worker',worker_boot_id:randomUUID(),owner_key:'openclaw-'+ 'c'.repeat(64),home_key:'d'.repeat(64),config_digest:'e'.repeat(64),config:{profile:'chat'}};
 const store={withOperation:async(_id,_action,fn)=>fn(row,'http://m1:5231')};
 for(const mutation of ['signature','nonce','home','boot']){
  const client=createAppServerClient({pool:{},store,env:{KERNEL_FLEET_BRIDGE_TOKEN:token},fetchFn:async(_url,options)=>{
   const body=JSON.parse(options.body),receipt={...workerIdentity(row),status:'running',request_nonce:body.request_nonce};
   if(mutation==='nonce')receipt.request_nonce=randomUUID();if(mutation==='home')receipt.home_key='f'.repeat(64);if(mutation==='boot')receipt.worker_boot_id=randomUUID();
   return new Response(JSON.stringify({receipt,signature:mutation==='signature'?'0'.repeat(64):createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')}));
  }});
  await expect(client.start(row.id)).rejects.toThrow(/^appserver_worker_(receipt_unverified|identity_mismatch)$/);
 }
});
