import { describe, expect, it } from 'vitest';
async function load() {
  const module=await import('./script-docker.cjs').catch(()=>({}));
  expect(module.createScriptDockerAdapter).toBeTypeOf('function');return module;
}
describe('脚本 Docker 强身份适配器',()=>{
  it('只用 execFile argv，固定隔离标志和受信限制，不拼宿主 shell/挂载',async()=>{
    const {createScriptDockerAdapter}=await load();const calls=[];
    const adapter=createScriptDockerAdapter({run:async(file,args)=>{calls.push([file,args]);return {stdout:'a'.repeat(64)};}});
    await adapter.create({name:'cecelia-script-123',command:'printf "$(touch /escape)"',
      identity:{reservation_id:'r',intent_id:'i',launch_generation:1},env:{TASK_X:'value'},
      profile:{image:`alpine@sha256:${'b'.repeat(64)}`,cpus:1,memoryBytes:67108864,pidsLimit:16,user:'1000:1000',cwd:'/job'}});
    expect(calls).toHaveLength(1);expect(calls[0][0]).toBe('docker');const argv=calls[0][1];
    for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--restart=no']) expect(argv).toContain(flag);
    expect(argv).toContain('--cpus=1');expect(argv).toContain('--memory=67108864');expect(argv).toContain('--pids-limit=16');
    expect(argv.some(x=>/--(volume|mount|privileged)/.test(x))).toBe(false);
    expect(argv.at(-1)).toBe('printf "$(touch /escape)"');
  });
  it('Docker 404类明确No such object才视为不存在；超时/权限问题保留unknown',async()=>{
    const {createScriptDockerAdapter}=await load();
    const absent=createScriptDockerAdapter({run:async()=>{throw Object.assign(new Error('missing'),{stderr:'Error: No such object: dead'});}});
    await expect(absent.inspect('dead')).resolves.toBeNull();
    for(const message of ['timeout','permission denied','daemon unavailable']) {
      const unknown=createScriptDockerAdapter({run:async()=>{throw new Error(message);}});
      await expect(unknown.inspect('dead')).rejects.toThrow(message);
    }
  });
});
