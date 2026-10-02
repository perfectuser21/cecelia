import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {markerFixture} from './fixtures.js';
const require=createRequire(import.meta.url);
it('真实fork/revision/marker竞态进入永久CI',()=>{
 execFileSync('python3',['-B','-m','unittest','test_maintenance','-v'],{cwd:fileURLToPath(new URL('.',import.meta.url)),stdio:['ignore','pipe','pipe'],timeout:20000});
});
it('本机空控制journal绝不能替配置物理target签静默',async()=>{
 const {createMaintenance}=require('./maintenance.cjs');
 const local=async()=>({draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:1,marker_identity:markerFixture});
 const maintenance=createMaintenance({local,targets:[{machine_id:'physical-fixture'}],probe:async()=>{throw Error('physical journal missing');}});
 const result=await maintenance();expect(result).toMatchObject({proof_scope:'hub-control',hub_control:{quiescent:true},pending:null,stable:false,quiescent:false});expect(result.targets).toEqual([{machine_id:'physical-fixture',status:'unknown'}]);
});
it('只有受信物理回执同boot/hash且稳定排空才可端到端静默',async()=>{
 const {createMaintenance}=require('./maintenance.cjs');
 const local=async()=>({draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:1,marker_identity:markerFixture});
 const probe=async()=>({maintenance:{draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:2,marker_identity:markerFixture}});
 expect((await createMaintenance({local,targets:[{machine_id:'fixture'}],probe})()).quiescent).toBe(true);
 for(const maintenance of [undefined,{pending:0},{quiescent:true,pending:0,stable:true,draining:false,in_flight:0,activity_revision:2}]){
  expect((await createMaintenance({local,targets:[{machine_id:'fixture'}],probe:async()=>({maintenance})})()).quiescent).toBe(false);
 }
});
it('整轮两次真实Python扫描之间marker rename重建也必须拒绝静默',async()=>{
 const {createMaintenance}=require('./maintenance.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-marker-round-')),journal=path.join(root,'journal'),marker=path.join(root,'drain');
 const source=fileURLToPath(new URL('.',import.meta.url));
 const script='import sys,json;sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[1]+"../phone-ssh");from journal import Journal;from maintenance import read_maintenance;print(json.dumps(read_maintenance(Journal(sys.argv[2]),sys.argv[3])))';
 const local=async()=>JSON.parse(execFileSync('python3',['-B','-c',script,source,journal,marker],{encoding:'utf8'}));
 try{
  fs.writeFileSync(marker,'drain');const before=fs.statSync(marker,{bigint:true});
  const aggregate=createMaintenance({local,targets:[{machine_id:'fixture'}],probe:async()=>{
   fs.renameSync(marker,marker+'.previous');fs.writeFileSync(marker,'drain');return {maintenance:await local()};
  }});
  const result=await aggregate();expect(fs.statSync(marker,{bigint:true}).ino).not.toBe(before.ino);
  expect(result.hub_control.activity_revision).toBe(0);expect(result.targets[0].status).toBe('verified');
  expect(result.stable).toBe(false);expect(result.quiescent).toBe(false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
