import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
let api={};try{api=require('./app-server-profile.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const sample=()=>({image:'sha256:'+'a'.repeat(64),cpus:2,memoryBytes:1073741824,pidsLimit:128,
 user:'1000:1000',tmpBytes:67108864,network:'none',homeKey:'b'.repeat(64),workspaceKey:'c'.repeat(64)});
describe('OpenClaw 受保护固定执行配置',()=>{
 it('业务工具精确名单进入不可变profile和digest，宿主执行与派生入口不能登记',()=>{
  const names=['message','memory_get','read'];
  const profile=api.validateAppServerProfile({...sample(),hostTools:names});
  names.push('exec');expect(profile.hostTools).toEqual(['memory_get','message','read']);
  expect(Object.isFrozen(profile.hostTools)).toBe(true);
  expect(api.profileDigest(profile)).not.toBe(api.profileDigest(sample()));
  for(const hostTools of [['exec'],['gateway_exec'],['sessions_spawn'],['nodes'],['process'],['read','read'],['unregistered_executor']]){
   expect(()=>api.validateAppServerProfile({...sample(),hostTools})).toThrow('appserver_profile_invalid');
  }
 });
 it('固定 profile 能导出稳定 digest，原对象改变不改变已确认快照',()=>{
  expect(api).toHaveProperty('validateAppServerProfile');
  const p=sample(),v=api.validateAppServerProfile(p);p.cpus=99;
  expect(v.cpus).toBe(2);expect(Object.isFrozen(v)).toBe(true);
  expect(api.profileDigest(v)).toMatch(/^[a-f0-9]{64}$/);
 });
 it.each([{image:'node:latest'},{cpus:NaN},{memoryBytes:0},{pidsLimit:0},{user:'0:0'},
 {network:'host'},{network:'bridge'},{tmpBytes:-1},{homeKey:'../../etc'},{workspaceKey:''},
 {argv:['sh','-c','anything']},{env:{TOKEN:'secret'}},{mount:'/var/run/docker.sock'}])('不可信配置拒绝 %j',(bad)=>{
  expect(api).toHaveProperty('validateAppServerProfile');
  expect(()=>api.validateAppServerProfile({...sample(),...bad})).toThrow('appserver_profile_invalid');
 });
 it('仅受保护服务配置文件可加载；没有文件默认没有执行能力',()=>{
  expect(api).toHaveProperty('loadAppServerProfiles');
  expect(api.loadAppServerProfiles()).toEqual({});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'appserver-profile-'));
  try{const file=path.join(dir,'profiles.json');fs.writeFileSync(file,JSON.stringify({profiles:{chat:sample()}}),{mode:0o600});
   expect(api.loadAppServerProfiles(file).chat.cpus).toBe(2);
   fs.chmodSync(file,0o644);expect(()=>api.loadAppServerProfiles(file)).toThrow('appserver_profiles_permissions');
   fs.chmodSync(file,0o600);fs.symlinkSync(file,path.join(dir,'link'));expect(()=>api.loadAppServerProfiles(path.join(dir,'link'))).toThrow('appserver_profiles_permissions');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
