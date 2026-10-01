import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createAppServerController} from '../controller.js';
const home={homeId:'chat-recovery',homeKey:'a'.repeat(64),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat',configDigest:'b'.repeat(64)};
function fixture(receipt){
 const old={id:randomUUID(),config:home,status:'running',machine_id:'xian-mac-m1'},calls=[];
 let current=old,failCancel=false;
 const store={home:async()=>({machine_id:old.machine_id}),latest:async()=>current,
  listOutstanding:async()=>current?[current]:[],get:async()=>old,
  observe:async(_id,v)=>{if(v.authenticated!==true)throw Error('appserver_worker_receipt_mismatch');return old;},
  requestCancel:async()=>{calls.push('intent');old.cancel_requested=true;},
  confirmCleanup:async()=>{calls.push('released');old.status='released';current=null;return old;},recordUnknown:async()=>{},
  reserve:async()=>{if(current)throw Error('appserver_home_busy');calls.push('reserve');return {outcome:'reserved',reservation:{...old,id:randomUUID(),status:'running'}};}};
 const client={inspect:async()=>({authenticated:true,receipt}),cancel:async()=>{calls.push('cancel');if(failCancel)throw Error('appserver_worker_unavailable');return {};},
  capabilities:async()=>({}),start:async()=>{calls.push('start');return {authenticated:true,receipt:{}};}};
 const controller=createAppServerController({pool:{},store,client,homes:{[home.homeId]:home},collectSnapshot:async()=>({})});
 return {controller,calls,old,client,loseCleanup:()=>{failCancel=true;}};
}
it.each([
 {status:'running',rpc_started:true,stream_status:'closed',stream_id:randomUUID()},
 {status:'exited'}, {status:'dead'},
])('确认不可复用的旧代通过精确取消后才释放：%j',async receipt=>{
 const f=fixture(receipt);expect((await f.controller.reconcile())[0].status).toBe('released');
 expect(f.calls).toEqual(['intent','cancel','released']);
});
it.each([
 {status:'running',rpc_started:true,stream_status:'attached',stream_id:randomUUID()},
 {status:'running',rpc_started:true,stream_status:'attaching',stream_id:randomUUID()},
 {status:'running',rpc_started:false,stream_status:'closed',stream_id:randomUUID()},
 {status:'unknown'}, {status:'running',rpc_started:true,stream_status:'closed'},
])('活跃、未知、可重新attach或无流身份均不自动取消：%j',async receipt=>{
 const f=fixture(receipt);await f.controller.reconcile();expect(f.calls).toEqual([]);expect(f.old.status).toBe('running');
});
it('清理网络未知保留预约，新请求不得启动第二代',async()=>{
 const f=fixture({status:'exited'});f.loseCleanup();
 await expect(f.controller.ensure({home_id:home.homeId,request_key:randomUUID()})).rejects.toThrow('appserver_worker_unavailable');
 expect(f.calls).toEqual(['intent','cancel']);expect(f.old.status).toBe('running');
});
it('新请求先清理已断流旧代，确认释放后才预约和启动',async()=>{
 const f=fixture({status:'running',rpc_started:true,stream_status:'closed',stream_id:randomUUID()});
 await f.controller.ensure({home_id:home.homeId,request_key:randomUUID()});
 expect(f.calls).toEqual(['intent','cancel','released','reserve','start']);
});
it('未认证inspect不能触发恢复清理',async()=>{
 const f=fixture({status:'exited'});f.client.inspect=async()=>({authenticated:false,receipt:{status:'exited'}});
 expect((await f.controller.reconcile())[0].status).toBe('unconfirmed');expect(f.calls).toEqual([]);
});
