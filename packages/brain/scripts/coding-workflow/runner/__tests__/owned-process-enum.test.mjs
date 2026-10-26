import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const moduleUrl = new URL('./helpers/owned-processes.mjs', import.meta.url);
async function fixture() {
  const m = await import(moduleUrl.href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-process-test-'));
  const env = m.createOwnedRegistry(root);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {registerOwnedProcess} from ${JSON.stringify(moduleUrl.href)};registerOwnedProcess();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`], {env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:true});
  try {
    await new Promise((resolve,reject)=>{const limit=setTimeout(()=>{clearInterval(timer);reject(Error('register timeout'));},2000);const timer=setInterval(()=>{if(fs.existsSync(path.join(env.CW_TEST_PROCESS_DIR,child.pid+'.json'))){clearInterval(timer);clearTimeout(limit);resolve();}},10);});
  } catch(error) { child.kill('SIGKILL'); fs.rmSync(root,{recursive:true,force:true}); throw error; }
  return {m,root,env,child,async clean(){await m.cleanupOwnedProcesses(env);fs.rmSync(root,{recursive:true,force:true});}};
}
it('真实PID/PPID登记可枚举并清理忽略TERM的独立进程组',async()=>{
  const f=await fixture();try{
    expect(f.m.ownedChildren(process.pid,f.env)).toEqual([f.child.pid]);
    f.child.kill('SIGTERM');expect(f.m.ownedChildren(process.pid,f.env)).toEqual([f.child.pid]);
    await f.m.cleanupOwnedProcesses(f.env);
    expect(()=>process.kill(f.child.pid,0)).toThrow();
  }finally{await f.clean();}
});
it('错误凭据、坏登记、未知父节点明确报错，无宿主枚举回退',async()=>{
  const f=await fixture();try{
    expect(()=>f.m.ownedChildren(process.pid,{...f.env,CW_TEST_PROCESS_KEY:'bad'})).toThrow(/registry/);
    expect(()=>f.m.ownedChildren(1,f.env)).toThrow(/unknown/);
    const file=path.join(f.env.CW_TEST_PROCESS_DIR,f.child.pid+'.json');const text=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,'{}');expect(()=>f.m.ownedChildren(process.pid,f.env)).toThrow(/record/);fs.writeFileSync(file,text);
  }finally{await f.clean();}
});
it('活PID若无法证明随机实例身份必须拒绝，不能向它发清理信号',async()=>{
  const f=await fixture();try{
    const file=path.join(f.env.CW_TEST_PROCESS_DIR,f.child.pid+'.json');const text=fs.readFileSync(file,'utf8');
    const record=JSON.parse(text);record.instance='f'.repeat(64);fs.writeFileSync(file,JSON.stringify(record));
    expect(()=>f.m.ownedChildren(process.pid,f.env)).toThrow(/record|identity/);
    await expect(f.m.cleanupOwnedProcesses(f.env)).rejects.toThrow(/record|identity/);
    expect(()=>process.kill(f.child.pid,0)).not.toThrow();fs.writeFileSync(file,text);
  }finally{await f.clean();}
});
it('即使登记签名有效，复用到无响应活PID也拒绝发信号',async()=>{
  const m=await import(moduleUrl.href);const {createHmac}=await import('node:crypto');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-reuse-'));const env=m.createOwnedRegistry(root);
  try{
    const row={pid:process.pid,ppid:1,instance:'e'.repeat(64)};
    const proof=createHmac('sha256',env.CW_TEST_PROCESS_KEY).update(JSON.stringify(row)).digest('hex');
    fs.writeFileSync(path.join(env.CW_TEST_PROCESS_DIR,process.pid+'.json'),JSON.stringify({...row,proof}));
    expect(()=>m.ownedChildren(1,env)).toThrow(/owned_identity_unverified/);
    await expect(m.cleanupOwnedProcesses(env)).rejects.toThrow(/owned_identity_unverified/);
    expect(()=>process.kill(process.pid,0)).not.toThrow();
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('测试pgrep仅支持-P，未知父节点退出3且不查询宿主',async()=>{
  const m=await import(moduleUrl.href);const {spawnSync}=await import('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-pgrep-'));const env=m.createOwnedRegistry(root);
  try{
    const installed=m.installOwnedPgrep(root,env);
    for(const args of [[],['-f','node'],['-P','1']]){
      const r=spawnSync('pgrep',args,{env:{...process.env,...env,...installed},encoding:'utf8'});
      expect(r.status,r.stderr).toBe(3);expect(r.stdout).toBe('');expect(r.stderr).toMatch(/owned_pgrep_arguments|owned_parent_unknown/);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
