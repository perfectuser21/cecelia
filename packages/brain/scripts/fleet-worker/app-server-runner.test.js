import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { profileDigest } = require('./app-server-profile.cjs');
let api = {}; try { api = require('./app-server-runner.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const profile = { image: `sha256:${'a'.repeat(64)}`, cpus: 2, memoryBytes: 1073741824,
  pidsLimit: 128, user: '1000:1000', tmpBytes: 67108864, network: 'none', homeKey: 'b'.repeat(64), workspaceKey: 'c'.repeat(64) };

function fixture() {
  expect(api).toHaveProperty('createAppServerRunner');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appserver-runner-'));
  const machineId = 'test-machine', workerId = 'worker-one', bootId = randomUUID();
  const containers = new Map(); let counter = 1, creates = 0, removes = 0, offline = false, rejectAdmission = false;
  const docker = {
    async create({ name, identity }) {
      const id = (counter++).toString(16).padStart(64, '0'); creates++;
      containers.set(id, { id, name, status: 'created', labels: Object.fromEntries(Object.entries(identity).map(([k,v]) => [`cecelia.appserver.${k}`, String(v)])) });
      return id;
    },
    async inspect(id) { if (offline) throw Error('daemon offline'); return containers.get(id) ?? [...containers.values()].find(c => c.name === id) ?? null; },
    async start(id) { containers.get(id).status = 'running'; },
    async remove(id) { removes++; containers.delete(id); },
    attach() {
      const child = new EventEmitter();
      return Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => child.emit('close', 0) });
    },
  };
  const config = { stateRoot: root, machineId, workerId, bootId, profiles: { chat: profile }, docker,
    assertLocalResources: async () => { if (rejectAdmission) throw Error('attempt_local_resources_unavailable'); } };
  const input = (overrides = {}) => ({ reservation_id: randomUUID(), intent_id: randomUUID(), launch_generation: 1,
    machine_id: machineId, worker_id: workerId, worker_boot_id: bootId, owner_key: `openclaw-${profile.homeKey}`,
    config_digest: profileDigest(profile), profile: 'chat', ...overrides });
  return { root, docker, config, input, containers, runner: api.createAppServerRunner(config),
    stats: () => ({ creates, removes }), offline: value => { offline = value; }, pressure: value => { rejectAdmission = value; },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('app-server generation 与 HOME 单写生命周期', () => {
  it('一代只允许一个stdio连接；断开只释放流租约，HOME和预算继续占位', async () => {
    const f = fixture(); try {
      const input = f.input(); await f.runner.start(input);
      expect(f.runner).toHaveProperty('attach');
      const connection = await f.runner.attach({ ...input, stream_id: randomUUID() });
      await expect(f.runner.attach({ ...input, stream_id: randomUUID() })).rejects.toThrow('appserver_stream_busy');
      connection.kill(); await new Promise(resolve => setTimeout(resolve, 20));
      await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
      expect((await f.runner.inspect(input)).status).toBe('running');
      expect(await f.runner.attach({ ...input, stream_id: randomUUID() })).toHaveProperty('stdin');
    } finally { f.cleanup(); }
  });
  it('Worker重启后旧流是否存活未知，拒绝新attach直到精确清理', async () => {
    const f = fixture(); try {
      const input = f.input(); const started = await f.runner.start(input);
      expect(f.runner).toHaveProperty('attach');
      await f.runner.attach({ ...input, stream_id: randomUUID() });
      const restarted = api.createAppServerRunner({ ...f.config, bootId: randomUUID() });
      await expect(restarted.attach({ ...input, stream_id: randomUUID() })).rejects.toThrow('appserver_stream_busy');
      expect((await restarted.cancel({ ...input, container_id: started.container_id, challenge: randomUUID() })).absent).toBe(true);
    } finally { f.cleanup(); }
  });
  it('重复start只观察同一容器，只有认证精确清理才释放HOME给新generation', async () => {
    const f = fixture(); try {
      const input = f.input(), a = await f.runner.start(input), b = await f.runner.start(input);
      expect(a.container_id).toBe(b.container_id); expect(f.stats().creates).toBe(1);
      await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
      const result = await f.runner.cancel({ ...input, container_id: a.container_id, challenge: randomUUID() });
      expect(result).toMatchObject({ absent: true, tombstoned: true, status: 'cleaned' });
      expect((await f.runner.start(f.input())).status).toBe('running'); expect(f.stats().creates).toBe(2);
    } finally { f.cleanup(); }
  });
  it('cancel先到持久墓碑，重启后迟到start仍拒绝', async () => {
    const f = fixture(); try {
      const input = f.input(); await f.runner.cancel({ ...input, container_id: null, challenge: randomUUID() });
      const restarted = api.createAppServerRunner({ ...f.config, bootId: randomUUID() });
      await expect(restarted.start(input)).rejects.toThrow('appserver_launch_tombstoned'); expect(f.stats().creates).toBe(0);
    } finally { f.cleanup(); }
  });
  it('新worker boot不能启动旧身份，但可使用持久旧身份清理已有容器', async () => {
    const f = fixture(); try {
      const input = f.input(), a = await f.runner.start(input);
      const restarted = api.createAppServerRunner({ ...f.config, bootId: randomUUID(), profiles: {} });
      expect((await restarted.cancel({ ...input, container_id: a.container_id, challenge: randomUUID() })).absent).toBe(true);
      await expect(restarted.start(f.input())).rejects.toThrow(/appserver_(profile_unavailable|worker_changed)/);
    } finally { f.cleanup(); }
  });
  it('Docker离线不能释放HOME；精确ID被替换不能删除替代对象', async () => {
    const f = fixture(); try {
      const input = f.input(), a = await f.runner.start(input), cancel = { ...input, container_id: a.container_id, challenge: randomUUID() };
      f.offline(true); await expect(f.runner.cancel(cancel)).rejects.toThrow(); f.offline(false);
      await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
      f.containers.get(a.container_id).id = 'f'.repeat(64);
      await expect(f.runner.cancel(cancel)).rejects.toThrow('appserver_identity_mismatch'); expect(f.stats().removes).toBe(0);
    } finally { f.cleanup(); }
  });
  it('容器自行退出或收到turn完成不释放HOME，也不会重新启动同一generation', async () => {
    const f = fixture(); try {
      const input = f.input(), a = await f.runner.start(input); f.containers.get(a.container_id).status = 'exited';
      expect((await f.runner.inspect(input)).status).toBe('exited');
      await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
      expect((await f.runner.start(input)).status).toBe('exited'); expect(f.stats().creates).toBe(1);
    } finally { f.cleanup(); }
  });
  it('压力阻断实际create；恢复同intent只启动一次', async () => {
    const f = fixture(); try {
      const input = f.input(); f.pressure(true);
      expect((await f.runner.start(input)).status).toBe('waiting_resources'); expect(f.stats().creates).toBe(0);
      f.pressure(false); expect((await f.runner.start(input)).status).toBe('running'); expect(f.stats().creates).toBe(1);
    } finally { f.cleanup(); }
  });
  it('create返回丢失后通过固定名字和标签找回exact ID，不重复create', async () => {
    const f = fixture(); try {
      const input = f.input(), original = f.docker.create;
      f.docker.create = async args => { await original(args); throw Error('response lost'); };
      await expect(f.runner.start(input)).rejects.toThrow('response lost');
      const observed = await f.runner.inspect(input); expect(observed.container_id).toMatch(/^[a-f0-9]{64}$/);
      expect((await f.runner.start(input)).status).toBe('created'); expect(f.stats().creates).toBe(1);
      expect((await f.runner.cancel({ ...input, container_id: observed.container_id, challenge: randomUUID() })).absent).toBe(true);
    } finally { f.cleanup(); }
  });
  it('拒绝外部命令/凭据字段以及跨代清理；journal不落聊天正文', async () => {
    const f = fixture(); try {
      const input = f.input(); await expect(f.runner.start({ ...input, token: 'secret' })).rejects.toThrow('appserver_identity_invalid');
      const a = await f.runner.start(input);
      await expect(f.runner.cancel({ ...input, intent_id: randomUUID(), container_id: a.container_id, challenge: randomUUID() })).rejects.toThrow('appserver_identity_mismatch');
      const contents = fs.readdirSync(f.root).filter(n => n.endsWith('.json')).map(n => fs.readFileSync(path.join(f.root,n),'utf8')).join('');
      expect(contents).not.toContain('secret'); expect(f.stats().removes).toBe(0);
    } finally { f.cleanup(); }
  });
});

it('旧boot等待资源不能在新Worker上重start，仍允许原身份精确清理',async()=>{
 const f=fixture();try{
  const input=f.input();f.pressure(true);await f.runner.start(input);f.pressure(false);
  const restarted=api.createAppServerRunner({...f.config,bootId:randomUUID()});
  await expect(restarted.start(input)).rejects.toThrow('appserver_worker_changed');expect(f.stats().creates).toBe(0);
  expect((await restarted.cancel({...input,container_id:null,challenge:randomUUID()})).absent).toBe(true);
 }finally{f.cleanup();}
});
it('runner attach真正执行双向帧边界，过大请求不进入docker stdin且只断流',async()=>{
 const f=fixture();try{
  const input=f.input();await f.runner.start(input);
  let raw;const attach=f.docker.attach;f.docker.attach=()=>{raw=attach();return raw;};
  const connection=await f.runner.attach({...input,stream_id:randomUUID()});let received=0;
  raw.stdin.on('data',chunk=>{received+=chunk.length;});
  const failure=once(connection.stdin,'error');connection.stdin.write('x'.repeat(1048577));
  expect((await failure)[0].message).toBe('appserver_frame_too_large');expect(received).toBe(0);
  await new Promise(resolve=>setTimeout(resolve,20));
  expect((await f.runner.inspect(input)).status).toBe('running');
  await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
 }finally{f.cleanup();}
});
it('runner输出分片完整JSONL才交付，不把凭据或错误正文写journal',async()=>{
 const f=fixture();try{
  const input=f.input();await f.runner.start(input);let raw;const attach=f.docker.attach;f.docker.attach=()=>{raw=attach();return raw;};
  const connection=await f.runner.attach({...input,stream_id:randomUUID()});const chunks=[];connection.stdout.on('data',chunk=>chunks.push(chunk));
  raw.stdout.write('{"secret":');expect(chunks).toHaveLength(0);raw.stdout.write('"test"}\n');
  expect(Buffer.concat(chunks).toString()).toBe('{"secret":"test"}\n');
  const journal=fs.readdirSync(f.root).filter(n=>n.endsWith('.json')).map(n=>fs.readFileSync(path.join(f.root,n),'utf8')).join('');expect(journal).not.toContain('secret');
  connection.kill();
 }finally{await new Promise(resolve=>setTimeout(resolve,20));f.cleanup();}
});
it('stdio错误未确认attach进程退出时不能开放第二连接', async () => {
  const f = fixture(); try {
    const input = f.input(); await f.runner.start(input);
    let raw; const attach = f.docker.attach;
    f.docker.attach = () => { raw = attach(); raw.kill = () => true; return raw; };
    const stream = await f.runner.attach({ ...input, stream_id: randomUUID() });
    stream.on('error', () => {});
    raw.emit('error', new Error('untrusted child error'));
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(f.runner.attach({ ...input, stream_id: randomUUID() })).rejects.toThrow('appserver_stream_busy');
    raw.emit('close', 1); await new Promise(resolve => setTimeout(resolve, 20));
    expect(await f.runner.attach({ ...input, stream_id: randomUUID() })).toHaveProperty('stdin');
  } finally { f.cleanup(); }
});
it('inspect持锁期间确认stdio关闭，锁释放后落盘并允许新流且不释放HOME', async () => {
  const f = fixture(); let release;
  try {
    const input = f.input(); await f.runner.start(input);
    const stream = await f.runner.attach({ ...input, stream_id: randomUUID() });
    const original = f.docker.inspect;
    let entered; const inspecting = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    f.docker.inspect = async id => { entered(); await held; return original(id); };
    const observation = f.runner.inspect(input); await inspecting;
    stream.kill();
    expect(JSON.parse(fs.readFileSync(path.join(f.root, `${input.reservation_id}.json`))).stream_status).toBe('attached');
    release(); await observation;
    const next = await f.runner.attach({ ...input, stream_id: randomUUID() });
    expect(next).toHaveProperty('stdin');
    await expect(f.runner.start(f.input())).rejects.toThrow('appserver_home_busy');
    next.kill();
  } finally { release?.(); await new Promise(resolve => setTimeout(resolve, 20)); f.cleanup(); }
});
it('cancel持锁关闭流后持久化closed与墓碑，不能因关闭回执覆盖清理结果', async () => {
  const f = fixture(); try {
    const input = f.input(), state = await f.runner.start(input);
    await f.runner.attach({ ...input, stream_id: randomUUID() });
    await f.runner.cancel({ ...input, container_id: state.container_id, challenge: randomUUID() });
    expect(JSON.parse(fs.readFileSync(path.join(f.root, `${input.reservation_id}.json`))))
      .toMatchObject({ stream_status: 'closed', status: 'cleaned', tombstoned: true });
    await expect(f.runner.attach({ ...input, stream_id: randomUUID() })).rejects.toThrow('appserver_launch_tombstoned');
  } finally { f.cleanup(); }
});
it('其他操作锁阻止关闭回执时保留事件，下次成功取得锁才重放', async () => {
  const f = fixture(); try {
    const input = f.input(); await f.runner.start(input);
    const stream = await f.runner.attach({ ...input, stream_id: randomUUID() });
    const lock = path.join(f.root, `${input.reservation_id}.lock`);
    fs.mkdirSync(lock, { mode: 0o700 }); stream.kill();
    await expect(f.runner.attach({ ...input, stream_id: randomUUID() })).rejects.toThrow('appserver_operation_locked');
    fs.rmdirSync(lock);
    expect(await f.runner.attach({ ...input, stream_id: randomUUID() })).toHaveProperty('stdin');
  } finally { f.cleanup(); }
});

it('稳定 HOME 与每代 owner 分离，代际重放不能借同 HOME 身份启动', async () => {
  const f = fixture(); try {
    const owner = input => `openclaw-${require('node:crypto').createHash('sha256').update(JSON.stringify([input.home_key,input.reservation_id,input.intent_id,input.launch_generation])).digest('hex')}`;
    const a = {...f.input(),home_key:profile.homeKey}; a.owner_key=owner(a);
    const started=await f.runner.start(a);
    const b={...f.input(),home_key:profile.homeKey,launch_generation:2};b.owner_key=owner(b);
    expect(b.owner_key).not.toBe(a.owner_key);
    await expect(f.runner.start(b)).rejects.toThrow('appserver_home_busy');
    await f.runner.cancel({...a,container_id:started.container_id,challenge:randomUUID()});
    expect((await f.runner.start(b)).status).toBe('running');
    await expect(f.runner.start({...f.input(),home_key:profile.homeKey,owner_key:a.owner_key})).rejects.toThrow('appserver_identity_mismatch');
  } finally {f.cleanup();}
});
