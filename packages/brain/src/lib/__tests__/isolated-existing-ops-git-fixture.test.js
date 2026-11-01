import {afterEach,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const removal=vi.hoisted(()=>({target:null,failures:0,attempts:0,code:'ENOTEMPTY',last:null,paths:[]}));
vi.mock('node:fs',async original=>{
 const actual=await original();return {...actual,rmSync:(path,options)=>{
  if(path===removal.target){removal.attempts++;removal.paths.push(path);if(removal.attempts<=removal.failures){removal.last=Object.assign(new Error('deterministic private directory removal race'),{code:removal.code});throw removal.last;}}
  return actual.rmSync(path,options);
 }};
});
import {isolatedExistingOpsGitFixture} from './helpers/isolated-existing-ops-git-fixture.js';
const owned=new Set();
function fixture(){const f=isolatedExistingOpsGitFixture({requireRuntime:false});owned.add(f.dir);return f;}
function interrupt(f,failures,code='ENOTEMPTY'){
 Object.assign(removal,{target:f.dir,failures,attempts:0,code,last:null,paths:[]});
}
afterEach(()=>{removal.target=null;for(const path of owned)rmSync(path,{recursive:true,force:true});owned.clear();});
it('finally close遇到两次ENOTEMPTY后仍真实删净私有clone，且不触碰其它目录',()=>{
 const f=fixture(),sibling=mkdtempSync(join(tmpdir(),'ci-cleanup-unrelated-'));owned.add(sibling);
 writeFileSync(join(sibling,'keep'),'unrelated');interrupt(f,2);
 try{expect(f.read('package.json')).toContain('cecelia');}finally{f.close();}
 expect(removal.attempts).toBe(3);expect(existsSync(f.dir)).toBe(false);
 expect(existsSync(join(sibling,'keep'))).toBe(true);expect(new Set(removal.paths)).toEqual(new Set([f.dir]));
});
it('持续ENOTEMPTY有界失败并保留最后原错误，不把未清理谎报成功',()=>{
 const f=fixture();interrupt(f,Infinity);let thrown;
 try{f.close();}catch(error){thrown=error;}
 expect(thrown).toBe(removal.last);expect(thrown.code).toBe('ENOTEMPTY');
 expect(removal.attempts).toBe(4);expect(existsSync(f.dir)).toBe(true);
});
it.each(['EACCES','EPERM','EIO'])('其它OS错误%s立即保留并抛出，不能借重试吞错',code=>{
 const f=fixture();interrupt(f,Infinity,code);let thrown;
 try{f.close();}catch(error){thrown=error;}
 expect(thrown).toBe(removal.last);expect(thrown.code).toBe(code);expect(removal.attempts).toBe(1);
 expect(existsSync(f.dir)).toBe(true);
});
it('本人fixture的每条Git命令禁用自动maintenance和后台gc，不写共享仓配置',()=>{
 const f=fixture();
 expect(f.git('config','--get','maintenance.auto').trim()).toBe('false');
 expect(f.git('config','--get','gc.auto').trim()).toBe('0');
 expect(f.git('config','--get','gc.autoDetach').trim()).toBe('false');
});
