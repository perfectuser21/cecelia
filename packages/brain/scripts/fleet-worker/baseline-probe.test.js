import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),{createLocalLaunchAdmission}=require('./local-resource-admission.cjs');
const image='sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';
it('固定维护probe只创建owned受限容器，精确清理后才产生OS/boot/config兼容证据',async()=>{
 const {createBaselineProbe}=require('./baseline-probe.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'baseline-probe-')),gate=createLocalLaunchAdmission({lstat:()=>({})});
 let container=null,failCleanup=false;const calls=[];let owner,workspace;
 const runCommand=async(file,args)=>{calls.push([file,args]);if(file==='sw_vers')return {stdout:'26.6.2\n'};
  if(file==='git'){if(args[0]==='worktree'&&args[1]==='add'){workspace=args[4];fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'.git'),'owned');}if(args[0]==='worktree'&&args[1]==='remove'){expect(args[3]).toBe(workspace);fs.rmSync(workspace,{recursive:true,force:true});workspace=null;}return {stdout:workspace?`worktree ${workspace}\n`:''};}
  if(args[0]==='image')return {stdout:JSON.stringify([{Id:image}])};
  if(args[0]==='create'){owner=args.find(s=>s.startsWith('cecelia.baseline.owner=')).split('=')[1];container={Id:'a'.repeat(64),Image:image,Config:{Labels:{'cecelia.baseline.owner':owner}},State:{Running:false,ExitCode:0},HostConfig:{NanoCpus:500000000,Memory:134217728,MemorySwap:134217728,PidsLimit:64,NetworkMode:'none',ReadonlyRootfs:true},Mounts:[{Type:'bind',RW:false,Destination:'/workspace',Source:args[args.indexOf('--mount')+1].split(',')[1].slice(4)}]};return {stdout:container.Id};}
  if(args[0]==='inspect'){if(!container)throw Object.assign(Error('not found'),{stderr:'No such container'});return {stdout:JSON.stringify([container])};}
  if(args[0]==='start')return {stdout:JSON.stringify({node:'v25.8.0',git:'git version 2.39.5',codex:'codex-cli 0.147.0',workspace:true,sandbox:true})};
  if(args[0]==='rm'){if(failCleanup)throw Error('cleanup unknown');container=null;return {stdout:''};}throw Error('unexpected command');};
 const options={root,workspaceBase:path.join(root,'shared'),gate,machineId:'xian-mac-m4',repoRoot:'/protected/repo',getConfigDigest:()=> 'c'.repeat(64),runCommand};
 try{let probe=createBaselineProbe(options);const receipt=await probe.run({expected_activity_revision:gate.snapshot().activity_revision,request_nonce:randomUUID(),expected_boot_id:gate.snapshot().boot_id,expected_config_digest:'c'.repeat(64),expected_image_digest:image});
  expect(receipt).toMatchObject({workspace_cleanup:{confirmed:true},os_version:'26.6.2',image_id:image,cleanup:{confirmed:true,absent:true},tools:{sandbox:true,workspace:true}});
  const args=calls.find(c=>c[1][0]==='create')[1];for(const v of ['--network=none','--read-only','--cpus=0.5','--memory=128m','--pids-limit=64','--cap-drop=ALL'])expect(args).toContain(v);
  failCleanup=true;await expect(probe.run({expected_activity_revision:gate.snapshot().activity_revision,request_nonce:randomUUID(),expected_boot_id:gate.snapshot().boot_id,expected_config_digest:'c'.repeat(64),expected_image_digest:image})).rejects.toThrow('worker_baseline_unconfirmed');
  const nextGate=createLocalLaunchAdmission({lstat:()=>({})});probe=createBaselineProbe({...options,gate:nextGate});expect(nextGate.snapshot().maintenance_pending).toBe(1);
  await expect(probe.run({expected_activity_revision:nextGate.snapshot().activity_revision,request_nonce:randomUUID(),expected_boot_id:nextGate.snapshot().boot_id,expected_config_digest:'c'.repeat(64),expected_image_digest:image})).rejects.toThrow();
  failCleanup=false;const receipt2=await probe.cleanup({request_nonce:randomUUID(),owner_nonce:owner,expected_boot_id:nextGate.snapshot().boot_id,expected_config_digest:'c'.repeat(64)});expect(receipt2.cleanup.confirmed).toBe(true);expect(nextGate.snapshot().maintenance_pending).toBe(0);expect(container).toBe(null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('崩溃journal没有父目录inode证据时不能冒称owned cleanup完成',async()=>{
 const {createBaselineProbe}=require('./baseline-probe.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'baseline-unknown-inode-')),nonce=randomUUID(),base=path.join(root,'shared'),parent=path.join(base,`cecelia-baseline-${nonce}`);
 const record={machine_id:'xian-mac-m4',request_nonce:nonce,image_id:image,container_name:`cecelia-baseline-${nonce}`,workspace_parent:parent,workspace_path:path.join(parent,'worktree'),worktree_attempted:false,cleanup:{confirmed:false}};fs.mkdirSync(parent,{recursive:true});fs.writeFileSync(path.join(root,'baseline-owner.json'),JSON.stringify(record),{mode:0o600});const gate=createLocalLaunchAdmission({lstat:()=>({})});
 try{const probe=createBaselineProbe({root,workspaceBase:base,gate,machineId:'xian-mac-m4',repoRoot:'/protected/repo',getConfigDigest:()=> 'c'.repeat(64),runCommand:async()=>{throw Object.assign(Error('absent'),{stderr:'No such container'});}});
  await expect(probe.cleanup({request_nonce:randomUUID(),owner_nonce:nonce,expected_boot_id:gate.snapshot().boot_id,expected_config_digest:'c'.repeat(64)})).rejects.toThrow('worker_baseline_unconfirmed');expect(fs.existsSync(parent)).toBe(true);expect(gate.snapshot().maintenance_pending).toBe(1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
