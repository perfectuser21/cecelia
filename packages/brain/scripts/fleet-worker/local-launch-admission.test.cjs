'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLocalLaunchAdmission,wrapLaunchRunner}=require('./local-resource-admission.cjs');
describe('Worker维护暂停的本机最终启动闸',()=>{
  it('读取真实marker、不使用health缓存；查询和清理命令保持可用',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'launch-drain-')),marker=path.join(dir,'drain');
    try{
      const gate=createLocalLaunchAdmission({markerPath:marker});gate.assertCanLaunch();
      const calls=[],run=gate.guardCommand(async(c,a)=>{calls.push([c,a]);return {stdout:''};});
      fs.writeFileSync(marker,'owned-maintenance');
      expect(()=>gate.assertCanLaunch()).toThrow('worker_draining');
      for(const action of ['create','start','run'])await expect(run('docker',[action,'own-container'])).rejects.toThrow('worker_draining');
      await run('docker',['inspect','own-container']);await run('docker',['rm','-f','own-container']);
      expect(calls.map(c=>c[1][0])).toEqual(['inspect','rm']);
      fs.unlinkSync(marker);gate.assertCanLaunch();
      fs.symlinkSync(path.join(dir,'missing'),marker);expect(()=>gate.assertCanLaunch()).toThrow('worker_draining');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('无权限读取marker视为暂停；同进程boot稳定，重启实例不同',()=>{
    const gate=createLocalLaunchAdmission({lstat:()=>{throw Object.assign(Error(),{code:'EACCES'});}});
    expect(gate.snapshot().draining).toBe(true);expect(()=>gate.assertCanLaunch()).toThrow('worker_draining');
    expect(gate.snapshot().boot_id).toBe(gate.snapshot().boot_id);
    expect(gate.snapshot().boot_id).not.toBe(createLocalLaunchAdmission().snapshot().boot_id);
  });
  it('在途prepare持续计数直到真实异步结束，调用方断开不造成假静默',async()=>{
    let release;const waiting=new Promise(resolve=>{release=resolve;});
    const gate=createLocalLaunchAdmission({lstat:()=>{throw Object.assign(Error(),{code:'ENOENT'});}});
    const runner=wrapLaunchRunner({prepare:async()=>{await waiting;throw Error('failed');},inspect:async()=> 'running'},gate);
    const work=runner.prepare();const rejected=expect(work).rejects.toThrow('failed');
    expect(gate.snapshot().in_flight_launches).toBe(1);expect(await runner.inspect()).toBe('running');
    release();await rejected;expect(gate.snapshot().in_flight_launches).toBe(0);
  });
});

it('聊天attach尚未完成时持续计数，不因HTTP请求端断开归零',async()=>{
 let release;const pending=new Promise(r=>release=r),gate=createLocalLaunchAdmission();
 const runner=wrapLaunchRunner({attach:async()=>{await pending;return 'attached';}},gate);
 const work=runner.attach();expect(gate.snapshot().in_flight_launches).toBe(1);release();await work;expect(gate.snapshot().in_flight_launches).toBe(0);
});
