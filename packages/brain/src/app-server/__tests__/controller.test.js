import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createAppServerController} from '../controller.js';
const home={homeId:'chat-test',homeKey:'a'.repeat(64),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat',configDigest:'b'.repeat(64)};
it('首次M1/M4离线可选择MMV，已有HOME离线不改派且缺默认配置不探测',async()=>{
 const row={id:randomUUID(),config:home,status:'running',machine_id:'us-mac-m4'},calls=[];
 const store={home:async()=>null,reserve:async()=>({outcome:'reserved',reservation:row}),observe:async()=>row,recordUnknown:async()=>{}};
 const client={capabilities:async(_h,m)=>{calls.push(m);if(m!=='us-mac-m4')throw Error('appserver_worker_unavailable');return {};},start:async()=>({})};
 const controller=createAppServerController({pool:{},store,client,homes:{[home.homeId]:home},collectSnapshot:async()=>({})});
 const input={home_id:home.homeId,request_key:randomUUID()};expect((await controller.ensure(input)).machine_id).toBe('us-mac-m4');expect(calls).toEqual(['xian-mac-m1','xian-mac-m4','us-mac-m4']);
 calls.length=0;store.home=async()=>({machine_id:'xian-mac-m1'});await expect(controller.ensure(input)).rejects.toThrow('appserver_worker_unavailable');expect(calls).toEqual(['xian-mac-m1']);
 calls.length=0;await expect(createAppServerController({pool:{},store,client,env:{}}).ensure(input)).rejects.toThrow('appserver_home_unconfigured');expect(calls).toEqual([]);
});
