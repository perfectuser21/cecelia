import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
it('固定canonical安装真实继承marker/锁FD并持锁到子进程结束，未知owner不能启动',()=>{
 const {restoreCanonicalRunner}=require('./canonical-runner-install.cjs');
 const {createDrainOwner}=require('./drain-owner.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canonical-install-')),marker=path.join(root,'fleet-worker.drain'),owner=randomUUID();
 const utility=createDrainOwner({marker,runLaunchctl:()=>{}});let calls=0;
 try {
  utility.drain('xian-mac-m4',owner);const before=fs.readFileSync(marker);
  const run=(command,args,options)=>{
   calls++;expect(command).toBe('/bin/bash');expect(args.slice(1)).toEqual(['xian-mac-m4','--apply','--restore-canonical-runner','a'.repeat(64)]);
   expect(()=>utility.undrain('xian-mac-m4',owner)).toThrow('drain_owner_busy');
   const child=spawnSync(process.execPath,['-e',"const fs=require('fs');if(!fs.fstatSync(3).isFile()||!fs.fstatSync(4).isDirectory())process.exit(2);JSON.parse(fs.readFileSync(3,'utf8'));"],options);
   expect(child.status).toBe(0);
   const guarded=spawnSync('python3',[new URL('./install-existing-config.py',import.meta.url).pathname,'canonical-install-guard','xian-mac-m4'],{...options,env:{...options.env,NODE_ENV:'test',FLEET_NODECTL_DRAIN_MARKER:marker}});
   expect(guarded.status).toBe(0);return {status:0};
  };
  expect(restoreCanonicalRunner('xian-mac-m4','a'.repeat(64),owner,{marker,run})).toEqual({installed:true});
  expect(fs.readFileSync(marker)).toEqual(before);
  expect(()=>restoreCanonicalRunner('xian-mac-m4','a'.repeat(64),randomUUID(),{marker,run})).toThrow('drain_owner_mismatch');
  expect(()=>restoreCanonicalRunner('us-mac-m4','a'.repeat(64),owner,{marker,run})).toThrow('canonical_runner_request_invalid');
  expect(calls).toBe(1);
  expect(()=>restoreCanonicalRunner('xian-mac-m4','a'.repeat(64),owner,{marker,run:()=>({status:1})})).toThrow('canonical_runner_install_failed');
  expect(fs.readFileSync(marker)).toEqual(before);expect(fs.existsSync(path.join(root,'.fleet-worker.drain.lock'))).toBe(false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
