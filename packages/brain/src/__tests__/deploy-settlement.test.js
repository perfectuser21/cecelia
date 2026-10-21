import { afterEach, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../../../../scripts/brain-image-retention/storage.mjs';
import { createDeploymentLedger } from '../../../../scripts/brain-image-retention/ledger.mjs';
const dirs=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const sha='a'.repeat(40), image='sha256:'+'b'.repeat(64), id='c'.repeat(64);
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'deployment-settled-')));dirs.push(root);const store=createStore(root);
 const state={image,sha,container:id,healthy:true,snapshots:0,drift:false};
 const health=async()=>({status:state.healthy?'healthy':'unhealthy',git_sha:state.sha,version:'1.2.3'});
 const docker={snapshot:async lease=>{await lease.assertHeld();state.snapshots++;return {containers:[{id:state.drift&&state.snapshots%2===0?'d'.repeat(64):state.container,name:'/cecelia-node-brain',running:true,image_id:state.image}],images:[{id:state.image,git_sha:state.sha,tags:['cecelia-brain:1.2.3']}]};},containerHealth:async(_id,lease)=>{await lease.assertHeld();return health();}};
 const ledger=createDeploymentLedger({store,docker,health});const request={deployment_id:randomUUID(),git_sha:sha,version:'1.2.3'};
 await ledger.begin(request);await ledger.finish(request.deployment_id,'success');state.snapshots=0;
 return {store,state,ledger,request};
}
it('真实锁内只读最后成功收据、当前镜像及健康，幂等且不写ledger',async()=>{
 const x=await fixture(),before=await x.store.read('ledger.json');const result=await x.ledger.settlement(sha);
 expect(result).toMatchObject({outcome:'success',git_sha:sha,image_id:image,container_id:id,deployment_id:x.request.deployment_id});
 expect(await x.store.read('ledger.json')).toEqual(before);
});
it.each(['pending','wrong-sha','wrong-image','unhealthy','container-drift','recovered'])('settled拒绝%s并保持账本不变',async kind=>{
 const x=await fixture();
 if(kind==='pending')await x.ledger.begin({...x.request,deployment_id:randomUUID()});
 if(kind==='wrong-sha')x.state.sha='e'.repeat(40);
 if(kind==='wrong-image')x.state.image='sha256:'+'f'.repeat(64);
 if(kind==='unhealthy')x.state.healthy=false;
 if(kind==='container-drift')x.state.drift=true;
 if(kind==='recovered')await x.store.withLock(async lease=>{const l=await x.store.read('ledger.json');l.successes[0].outcome='recovered';await x.store.save('ledger.json',l,lease);});
 const before=await x.store.read('ledger.json');await expect(x.ledger.settlement(sha)).rejects.toThrow();expect(await x.store.read('ledger.json')).toEqual(before);
});
it('operation.lock忙直接拒绝，不伪造lease也不触碰Docker',async()=>{
 const x=await fixture();await x.store.withLock(async()=>{await expect(x.ledger.settlement(sha)).rejects.toThrow(/BUSY/);});expect(x.state.snapshots).toBe(0);
});
