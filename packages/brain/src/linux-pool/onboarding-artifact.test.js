import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {createOnboardingArtifacts} from './onboarding-artifact.js';
const roots=[];afterEach(()=>{for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'linux-artifact-'));roots.push(root);return {root,pathRoot:root,owner:process.getuid(),revision:'a'.repeat(40)};}
it('真实源码和远端程序600固定工件落盘，镜像升级后仍读取原revision及原字节',()=>{
 const options=setup(),first=createOnboardingArtifacts(options).capture(),file=path.join(options.root,'artifacts',first.revision+'.json');
 expect(fs.statSync(file).mode&0o777).toBe(0o600);expect(Object.keys(first.files)).toHaveLength(15);expect(first.program).toContain('def dispatch(');
 const next=createOnboardingArtifacts({...options,revision:'b'.repeat(40),load:()=>{throw Error('must not read new image sources');}});
 expect(next.read(first.revision,first.digest)).toEqual(first);
 expect(()=>next.read(first.revision,'f'.repeat(64))).toThrow('linux_pool_artifact_unavailable');
});
it('同SHA不同源码不能覆盖旧工件；宽权限、符号链接和非SHA版本拒绝',()=>{
 const options=setup(),store=createOnboardingArtifacts(options),first=store.capture(),file=path.join(options.root,'artifacts',first.revision+'.json'),raw=fs.readFileSync(file,'utf8');
 expect(()=>createOnboardingArtifacts({...options,load:()=>({files:first.files,program:'different'})}).capture()).toThrow();expect(fs.readFileSync(file,'utf8')).toBe(raw);
 fs.chmodSync(file,0o644);expect(()=>store.read(first.revision,first.digest)).toThrow();fs.chmodSync(file,0o600);
 fs.renameSync(file,file+'.other');fs.symlinkSync(file+'.other',file);expect(()=>store.read(first.revision,first.digest)).toThrow();
 expect(()=>createOnboardingArtifacts({...options,revision:'unknown'}).capture()).toThrow();
});
