import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const roots = [];
const servers = [];
const runners = [];
afterEach(async () => { for(const runner of runners.splice(0)) runner.close?.(); for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  for (const root of roots.splice(0)) rmSync(root,{ recursive:true,force:true }); });
async function setup() {
  const api = await import('./script-runner.cjs').catch(() => ({}));
  expect(api.createScriptRunner, '缺少受管脚本执行器').toBeTypeOf('function');
  const root = mkdtempSync(path.join(tmpdir(),'script-worker-')); roots.push(root);
  const containers = new Map(); let creates = 0; let starts = 0;
  const docker = {
    async create({ name, command }) { creates++; const id='a'.repeat(64);
      containers.set(name,{ id,name,status:'created',command,exit_code:null,stdout:'' }); return id; },
    async inspect(id) { return [...containers.values()].find((c) => c.id===id || c.name===id) ?? null; },
    async start(id) { starts++; const c=await this.inspect(id); c.status='running';
      const result=await exec('/bin/sh',['-c',c.command]); c.stdout=result.stdout;c.exit_code=0;c.status='exited'; },
    async remove(id) { const c=await this.inspect(id); if(c) containers.delete(c.name); },
  };
  const options = { assertLocalResources:async()=>{},stateRoot:root,machineId:'us-mac-m4',workerId:'worker-1',bootId:'boot-1',docker,
    profiles:{ harmless:{ image:`alpine@sha256:${'b'.repeat(64)}`,cpus:1,memoryBytes:67108864,pidsLimit:16,user:'1000:1000',cwd:'/job' } } };
  const runner=api.createScriptRunner(options);runners.push(runner);
  const input={ reservation_id:randomUUID(),machine_id:'us-mac-m4',owner_key:`script-${randomUUID()}-a1`,
    intent_id:randomUUID(),launch_generation:1,worker_id:'worker-1',worker_boot_id:'boot-1',config_digest:'c'.repeat(64),
    job:{ profile:'harmless',cmd:'printf managed-script-ok',timeout_sec:30,env:{} } };
  const digest=(v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  input.config_digest=digest({job:input.job,profile_digest:digest(options.profiles.harmless)});
  return { api,root,containers,docker,options,runner,input,counts:()=>({creates,starts}) };
}
describe('受管脚本 worker 协议', () => {
  it('真实 HTTP 认证后启动无害脚本，持久意图先于 create，重复/重启请求不重跑', async () => {
    const x=await setup();
    const original=x.docker.create;
    x.docker.create=async (spec) => {
      const state=JSON.parse(readFileSync(path.join(x.root,`${x.input.reservation_id}.json`),'utf8'));
      expect(state.intent_id).toBe(x.input.intent_id); expect(state.status).toBe('launching');
      return original(spec);
    };
    const { createFleetWorkerServer }=require('./fleet-worker.cjs');
    const token='test-worker-token-'.repeat(4);
    const server=createFleetWorkerServer({ machineId:'us-mac-m4',attemptToken:token,scriptRunner:x.runner });
    servers.push(server); await new Promise((r)=>server.listen(0,'127.0.0.1',r));
    const url=`http://127.0.0.1:${server.address().port}/scripts/${x.input.reservation_id}/start`;
    expect((await fetch(url,{ method:'POST',body:JSON.stringify(x.input) })).status).toBe(401);
    const response=await fetch(url,{ method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(x.input) });
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.receipt.terminal.stdout).toBe('managed-script-ok');
    expect(result.signature).toBe(createHmac('sha256',token).update(JSON.stringify(result.receipt)).digest('hex'));
    await x.runner.start(x.input);
    await x.api.createScriptRunner(x.options).start(x.input);
    expect(x.counts()).toEqual({ creates:1,starts:1 });
  });
  it('取消先落墓碑，晚到同代 start 被拒绝；缺失容器不能直接冒充强回执', async () => {
    const x=await setup();
    const body={ ...x.input,challenge:randomUUID(),container_id:null,worker_id:'worker-1',worker_boot_id:'boot-1' };
    const receipt=await x.runner.cancel(body);
    expect(receipt).toMatchObject({status:'cleaned',absent:true,tombstoned:true,challenge:body.challenge,container_id:null});
    await expect(x.runner.start(x.input)).rejects.toThrow('script_launch_tombstoned');
    await expect(x.runner.inspect({...x.input,reservation_id:randomUUID()})).rejects.toThrow('script_intent_unknown');
    expect(x.counts()).toEqual({creates:0,starts:0});
  });
  it('启动丢响应后凭持久身份 inspect，认证 cancel 精确清理后才确认', async () => {
    const x=await setup(); await x.runner.start(x.input);
    const restored=x.api.createScriptRunner({...x.options,bootId:'boot-2'});
    const state=await restored.inspect(x.input);
    expect(state).toMatchObject({status:'exited',container_id:'a'.repeat(64),worker_boot_id:'boot-1'});
    await expect(restored.cancel({...x.input,challenge:randomUUID(),container_id:'d'.repeat(64)})).rejects.toThrow('script_identity_mismatch');
    const receipt=await restored.cancel({...x.input,challenge:randomUUID(),container_id:state.container_id});
    expect(receipt).toMatchObject({status:'cleaned',container_id:state.container_id,absent:true,tombstoned:true,worker_boot_id:'boot-1'});
    expect(x.containers.size).toBe(0);
    await expect(restored.start(x.input)).rejects.toThrow('script_launch_tombstoned');
  });
  it.each(['mounts','cwd','command','docker_socket'])('拒绝任务注入宿主能力 %s', async (field) => {
    const x=await setup();
    await expect(x.runner.start({...x.input,job:{...x.input.job,[field]:'/etc'}})).rejects.toThrow('script_job_field_rejected');
    expect(x.counts()).toEqual({creates:0,starts:0});
  });
  it('缺少受信资源配置或未知 profile 拒绝启动', async () => {
    const x=await setup();
    await expect(x.runner.start({...x.input,job:{...x.input.job,profile:'unknown'}})).rejects.toThrow('script_profile_unavailable');
    const runner=x.api.createScriptRunner({...x.options,profiles:{harmless:{image:'alpine'}}});
    await expect(runner.start(x.input)).rejects.toThrow('script_profile_invalid');
  });
  it('新代次/新配置不能覆盖持久启动身份', async () => {
    const x=await setup(); await x.runner.start(x.input);
    await expect(x.runner.start({...x.input,launch_generation:2})).rejects.toThrow('script_identity_mismatch');
    await expect(x.runner.start({...x.input,config_digest:'d'.repeat(64)})).rejects.toThrow('script_identity_mismatch');
    expect(x.counts()).toEqual({creates:1,starts:1});
  });
});

it('部署 profile 改动后拒绝旧 digest，首次请求不能伪造配置身份',async()=>{
  const x=await setup();
  await expect(x.runner.start({...x.input,config_digest:'0'.repeat(64)})).rejects.toThrow('script_config_digest_mismatch');
  expect(x.counts()).toEqual({creates:0,starts:0});
});
it('worker 定时清理超时容器并持久保存124，重启后仍能读取终态',async()=>{
  const x=await setup();
  const digest=(v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  x.input.job.timeout_sec=1;
  x.input.config_digest=digest({job:x.input.job,profile_digest:digest(x.options.profiles.harmless)});
  x.docker.start=async(id)=>{const c=await x.docker.inspect(id);c.status='running';};
  await x.runner.start(x.input);
  await new Promise((r)=>setTimeout(r,1200));
  expect(x.containers.size).toBe(0);
  const restored=x.api.createScriptRunner(x.options);runners.push(restored);
  await expect(restored.inspect(x.input)).resolves.toMatchObject({status:'cleaned',terminal:{exit_code:124,timed_out:true}});
});

it('每个新启动即时复验；缺本机probe和容量预留后压力升高都不执行',async()=>{
  const x=await setup();
  const missing=x.api.createScriptRunner({...x.options,assertLocalResources:undefined});runners.push(missing);
  await expect(missing.start(x.input)).rejects.toThrow('script_local_resources_unavailable');
  let count=0;
  const pressured=x.api.createScriptRunner({...x.options,assertLocalResources:async()=>{
    if(++count===2)throw new Error('attempt_local_resources_unavailable');
  }});runners.push(pressured);
  await expect(pressured.start(x.input)).resolves.toMatchObject({status:'waiting_resources'});
  expect(x.counts()).toEqual({creates:1,starts:0});
});

it.each(['worker_id','worker_boot_id'])('错误 %s 的取消不得删除容器或写墓碑',async(field)=>{
  const x=await setup();await x.runner.start(x.input);
  await expect(x.runner.cancel({...x.input,[field]:'wrong',container_id:'a'.repeat(64),challenge:randomUUID()})).rejects.toThrow('script_identity_mismatch');
  expect(x.containers.size).toBe(1);
  expect(JSON.parse(readFileSync(path.join(x.root,`${x.input.reservation_id}.json`),'utf8')).tombstoned).toBe(false);
});
it('大量转义和多字节stdout不会扩大认证回执，清理不依赖日志读取',async()=>{
  const x=await setup();await x.runner.start(x.input);
  const c=[...x.containers.values()][0];c.stdout=('"\\汉字').repeat(40000);
  const state=await x.runner.inspect(x.input);
  expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThan(100000);
  expect(state.terminal.logs_truncated).toBe(true);
  x.docker.logs=async()=>{throw new Error('logs_read_failed');};
  const receipt=await x.runner.cancel({...x.input,container_id:c.id,challenge:randomUUID()});
  expect(receipt.status).toBe('cleaned');expect(x.containers.size).toBe(0);
});
