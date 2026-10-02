import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
const require=createRequire(import.meta.url);
it('canonical安装持自属drain合作锁到子进程结束，其它正常undrain无法介入',()=>{
 const {createDrainOwner}=require('./drain-owner.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-install-')),marker=path.join(root,'fleet-worker.drain'),id=randomUUID();
 const owner=createDrainOwner({marker,runLaunchctl:()=>{}});
 try {
  owner.drain('xian-mac-m4',id); const original=fs.readFileSync(marker);
  expect(owner.withOwned('xian-mac-m4',id,()=>{
   expect(()=>owner.undrain('xian-mac-m4',id)).toThrow('drain_owner_busy');
   expect(fs.readFileSync(marker)).toEqual(original); return 'installed';
  })).toBe('installed');
  expect(()=>owner.withOwned('xian-mac-m4',randomUUID(),()=>{})).toThrow('drain_owner_mismatch');
  expect(owner.undrain('xian-mac-m4',id).released).toBe(true);
  expect(()=>owner.withOwned('xian-mac-m4',id,()=>{})).toThrow('drain_owner_unconfirmed');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
it('固定marker独占创建，别人owner/替换inode/合作锁不得覆盖或释放，失败重启保持drain',()=>{
 const {createDrainOwner}=require('./drain-owner.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-owner-')),marker=path.join(root,'fleet-worker.drain'),first=randomUUID(),other=randomUUID();
 const calls=[];let failStart=false;
 const spawn=(args)=>{calls.push(args);if(failStart&&args[0]==='kickstart')throw Error('launch failed');return {stdout:''};};
 const owner=createDrainOwner({marker,runLaunchctl:spawn});
 try{
  const created=owner.drain('xian-mac-m4',first);expect(created.created).toBe(true);const original=fs.readFileSync(marker,'utf8'),stat=fs.statSync(marker);
  expect(()=>owner.drain('xian-mac-m4',other)).toThrow('drain_owner_mismatch');expect(()=>owner.undrain('xian-mac-m4',other)).toThrow('drain_owner_mismatch');expect(fs.readFileSync(marker,'utf8')).toBe(original);
  expect(owner.drain('xian-mac-m4',first).created).toBe(false);expect(calls.filter(a=>a[0]==='bootout')).toHaveLength(1);
  fs.mkdirSync(path.join(root,'.fleet-worker.drain.lock'),{mode:0o700});expect(()=>owner.undrain('xian-mac-m4',first)).toThrow('drain_owner_busy');fs.rmdirSync(path.join(root,'.fleet-worker.drain.lock'));
  fs.renameSync(marker,path.join(root,'original'));fs.writeFileSync(marker,original,{mode:0o600});expect(fs.statSync(marker).ino).not.toBe(stat.ino);expect(()=>owner.undrain('xian-mac-m4',first)).toThrow('drain_owner_mismatch');expect(fs.existsSync(marker)).toBe(true);
  fs.unlinkSync(marker);fs.renameSync(path.join(root,'original'),marker);
  failStart=true;expect(()=>owner.undrain('xian-mac-m4',first)).toThrow('drain_launch_unconfirmed');expect(fs.existsSync(marker)).toBe(true);
  failStart=false;expect(createDrainOwner({marker,runLaunchctl:spawn}).undrain('xian-mac-m4',first).released).toBe(true);expect(fs.existsSync(marker)).toBe(false);
  fs.writeFileSync(marker,'legacy-other-owner',{mode:0o600});expect(()=>owner.drain('xian-mac-m4',first)).toThrow('drain_owner_unconfirmed');expect(()=>owner.undrain('xian-mac-m4',first)).toThrow('drain_owner_unconfirmed');expect(fs.readFileSync(marker,'utf8')).toBe('legacy-other-owner');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('真实O_EXCL竞争不能覆写突现marker，自有父目录原子锁排斥第二个进程',async()=>{
 const {createDrainOwner}=require('./drain-owner.cjs'),{spawn}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-race-')),marker=path.join(root,'fleet-worker.drain'),owner=randomUUID();const originalOpen=fs.openSync;
 try{
  let raced=false;fs.openSync=function(file,flags,...rest){if(file===marker&&(flags&fs.constants.O_EXCL)&&!raced){raced=true;fs.writeFileSync(marker,'other-created',{mode:0o600});}return originalOpen.call(fs,file,flags,...rest);};
  expect(()=>createDrainOwner({marker,runLaunchctl:()=>{}}).drain('xian-mac-m4',owner)).toThrow();expect(fs.readFileSync(marker,'utf8')).toBe('other-created');fs.openSync=originalOpen;fs.unlinkSync(marker);
  const launchctl=path.join(root,'launchctl');fs.writeFileSync(launchctl,'#!/bin/sh\nsleep 0.2\n',{mode:0o700});
  const run=nonce=>new Promise(resolve=>{const child=spawn(process.execPath,[path.join(path.dirname(new URL(import.meta.url).pathname),'drain-owner.cjs'),'drain','xian-mac-m4'],{env:{...process.env,NODE_ENV:'test',FLEET_NODECTL_DRAIN_MARKER:marker,FLEET_NODECTL_DRAIN_OWNER:nonce,FLEET_NODECTL_LAUNCHCTL:launchctl},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('exit',code=>resolve({code,error}));});
  const outcomes=await Promise.all([run(randomUUID()),run(randomUUID())]);expect(outcomes.map(o=>o.code).sort()).toEqual([0,1]);expect(outcomes.find(o=>o.code===1).error).toMatch(/drain_owner_(busy|mismatch)/);expect(JSON.parse(fs.readFileSync(marker,'utf8')).schema).toBe('fleet-drain-owner/v1');
 }finally{fs.openSync=originalOpen;fs.rmSync(root,{recursive:true,force:true});}
});
it('生产CLI不接收任意marker或launchctl路径，拒绝前没有文件副作用',()=>{
 const {spawnSync}=require('node:child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-fixed-cli-')),marker=path.join(root,'arbitrary-marker');
 try{const result=spawnSync(process.execPath,[path.join(path.dirname(new URL(import.meta.url).pathname),'drain-owner.cjs'),'drain','xian-mac-m4'],{env:{...process.env,NODE_ENV:'production',FLEET_NODECTL_DRAIN_MARKER:marker,FLEET_NODECTL_DRAIN_OWNER:randomUUID()},encoding:'utf8'});expect(result.status).toBe(1);expect(result.stderr).toContain('drain_owner_path_invalid');expect(fs.readdirSync(root)).toEqual([]);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
