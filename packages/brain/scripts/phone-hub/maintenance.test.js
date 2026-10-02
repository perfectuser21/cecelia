import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
it('真实fork/revision/marker竞态进入永久CI',()=>{
 execFileSync('python3',['-B','-m','unittest','test_maintenance','-v'],{cwd:fileURLToPath(new URL('.',import.meta.url)),stdio:['ignore','pipe','pipe'],timeout:20000});
});
it('本机空控制journal绝不能替配置物理target签静默',async()=>{
 const {createMaintenance}=require('./maintenance.cjs');
 const local=async()=>({draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:1});
 const maintenance=createMaintenance({local,targets:[{machine_id:'physical-fixture'}],probe:async()=>{throw Error('physical journal missing');}});
 const result=await maintenance();expect(result).toMatchObject({proof_scope:'hub-control',hub_control:{quiescent:true},pending:null,stable:false,quiescent:false});expect(result.targets).toEqual([{machine_id:'physical-fixture',status:'unknown'}]);
});
it('只有受信物理回执同boot/hash且稳定排空才可端到端静默',async()=>{
 const {createMaintenance}=require('./maintenance.cjs');
 const local=async()=>({draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:1});
 const probe=async()=>({maintenance:{draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:2}});
 expect((await createMaintenance({local,targets:[{machine_id:'fixture'}],probe})()).quiescent).toBe(true);
 for(const maintenance of [undefined,{pending:0},{quiescent:true,pending:0,stable:true,draining:false,in_flight:0,activity_revision:2}]){
  expect((await createMaintenance({local,targets:[{machine_id:'fixture'}],probe:async()=>({maintenance})})()).quiescent).toBe(false);
 }
});
