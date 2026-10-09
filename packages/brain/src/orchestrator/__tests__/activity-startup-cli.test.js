import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const cli = fileURLToPath(new URL('../../../scripts/activity-contract-run.js', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'activity-startup-cli-'));
  await writeFile(join(cwd, 'activity.mjs'), `import fs from 'node:fs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
fs.appendFileSync(input.trace,'called\\n');
if(input.block)while(!fs.existsSync(input.release))await new Promise(done=>setTimeout(done,20));
process.stdout.write(JSON.stringify({schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{},metrics:{},evidence:[]}));`);
  const receipt = join(cwd, 'progress.json'), startup = join(cwd, 'startup.json'), id = randomUUID();
  const envelope = { contract: { workflow: 'startup-smoke', activities: [{ key: 'work', order: 1,
    budget: { max_duration_s: 10, heartbeat_s: 1 }, failure: { empty_ok: [], retryable: [], fatal: [], needs_human: { cases: [] } },
    runtime: { phase: 'batch_end', protocol: 'json-stdio-v1', entry: 'activity.mjs' } }] },
    input: { run_tag: 'same-tag', trace: join(cwd, 'calls'), release: join(cwd, 'release') } };
  const children = [];
  const run = (args = ['--startup-receipt', startup, '--startup-id', id], value = envelope, env = {}, withReceipt = true) => {
    const child = spawn(process.execPath, [cli, '--cwd', cwd, ...(withReceipt ? ['--receipt', receipt] : []), ...args],
      { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '', closed = false;
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(value));
    const done = new Promise(resolve => child.on('close', code => { closed = true; resolve({ code, stdout, stderr, result: JSON.parse(stdout) }); }));
    return { done, closed: () => closed, stdout: () => stdout };
  };
  return { cwd, receipt, startup, id, envelope, run,
    async cleanup() { await writeFile(envelope.input.release, ''); for (const child of children) if(child.exitCode===null)child.kill('SIGTERM'); await rm(cwd,{recursive:true,force:true}); } };
}
async function waitFor(path, process) {
  for (let i=0;i<150;i++) { try { return await readFile(path,'utf8'); } catch {} if(process.closed())break; await sleep(20); }
  const outcome = process.closed() ? await process.done : null;
  throw Error(`真实CLI未发布起跑凭证: ${JSON.stringify(outcome)}`);
}
test('真实CLI：阻塞活动终态前发布0600 START并仅执行一次，stdout保持终态JSON', async () => {
  const f = await setup();
  try {
    f.envelope.input.block = true;
    const process = f.run();
    const raw = await waitFor(f.startup, process), start = JSON.parse(raw);
    await waitFor(f.envelope.input.trace, process);
    expect(process.closed()).toBe(false); expect(process.stdout()).toBe('');
    expect(JSON.parse(await readFile(f.receipt,'utf8')).status).toBe('running');
    expect(start).toEqual({schema_version:1,event_type:'WF_RUN_STARTED',run_tag:'same-tag',workflow:'startup-smoke',cursor:1,
      startup_id:f.id,at:expect.any(String),contract_sha256:sha(f.envelope.contract),input_sha256:sha(f.envelope.input)});
    expect(start.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);expect(Number.isFinite(Date.parse(start.at))).toBe(true);
    expect((await stat(f.startup)).mode & 0o777).toBe(0o600);
    await writeFile(f.envelope.input.release,'');
    const out = await process.done;expect(out.code,out.stderr).toBe(0);
    expect(await readFile(f.startup,'utf8')).toBe(raw);
    expect(JSON.parse(await readFile(f.receipt,'utf8'))).toEqual(out.result);
    expect(await readFile(f.envelope.input.trace,'utf8')).toBe('called\n');
    expect(out.stdout.trim().split('\n')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 15000);

test('快任务终态后START仍保持首事件摘要且临时文件已清理；旧无旗标兼容', async () => {
  const f = await setup();
  try {
    const out=await f.run().done; expect(out.code).toBe(0);
    const start=JSON.parse(await readFile(f.startup,'utf8')); expect(start.cursor).toBe(1);expect(start.input_sha256).toBe(sha(f.envelope.input));
    expect((await readdir(f.cwd)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
    const legacy=await f.run([]).done;expect(legacy.code).toBe(0);expect(legacy.result.status).toBe(out.result.status);expect(legacy.result.outputs).toEqual(out.result.outputs);
    expect(JSON.parse(await readFile(f.receipt,'utf8'))).toEqual(legacy.result);
    expect(JSON.parse(await readFile(f.startup,'utf8'))).toEqual(start);
  } finally {await f.cleanup();}
});
test.each(['contract','input'])('无效%s不发布START且不执行活动', async field => {
  const f=await setup();try {
    if(field==='contract') f.envelope.contract.activities=[];else delete f.envelope.input.run_tag;
    const out=await f.run().done;expect(out.code).toBe(1);expect(out.result.reason_code).toBe('invalid_contract');
    await expect(stat(f.startup)).rejects.toThrow();await expect(stat(f.envelope.input.trace)).rejects.toThrow();
  }finally{await f.cleanup();}
});
test.each(['startup','progress'])('%s写失败沿event_sink_failed收工，不发布START不执行主活动',async field=>{
  const f=await setup();try {
    const bad=join(f.cwd,'activity.mjs','blocked.json');
    const args=['--startup-receipt',field==='startup'?bad:f.startup,'--startup-id',f.id];
    if(field==='progress')args.push('--receipt',bad);
    const out=await f.run(args).done;expect(out.code).toBe(1);expect(out.result.reason_code).toBe('event_sink_failed');
    await expect(stat(f.startup)).rejects.toThrow();await expect(stat(f.envelope.input.trace)).rejects.toThrow();
  }finally{await f.cleanup();}
});
test('同TAG旧凭证已有文件不覆写、不当本次nonce、不执行第二次活动',async()=>{
  const f=await setup();try{
    expect((await f.run().done).code).toBe(0);const old=await readFile(f.startup,'utf8');
    const out=await f.run(['--startup-receipt',f.startup,'--startup-id',randomUUID()]).done;
    expect(out.code).toBe(1);expect(out.result.reason_code).toBe('event_sink_failed');expect(await readFile(f.startup,'utf8')).toBe(old);
    expect(await readFile(f.envelope.input.trace,'utf8')).toBe('called\n');
    expect((await readdir(f.cwd)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
  }finally{await f.cleanup();}
});
test.each(['missing-id','missing-path','bad-id','duplicate-id','duplicate-path','same-path'])('参数%s在活动前拒绝',async kind=>{
 const f=await setup();try{
   const args={ 'missing-id':['--startup-receipt',f.startup], 'missing-path':['--startup-id',f.id],
     'bad-id':['--startup-receipt',f.startup,'--startup-id','bad'],
     'duplicate-id':['--startup-receipt',f.startup,'--startup-id',f.id,'--startup-id',f.id],
     'duplicate-path':['--startup-receipt',f.startup,'--startup-id',f.id,'--startup-receipt',f.startup],
     'same-path':['--startup-receipt',f.receipt,'--startup-id',f.id]}[kind];
   const out=await f.run(args).done;expect(out.code).toBe(1);expect(out.result.detail).toBe('invalid_cli_argument');
   await expect(stat(f.startup)).rejects.toThrow();await expect(stat(f.envelope.input.trace)).rejects.toThrow();
 }finally{await f.cleanup();}
});
test('eventDb无法提交读回时不发布START、不执行活动',async()=>{
 const f=await setup();try{
   const out=await f.run(['--startup-receipt',f.startup,'--startup-id',f.id,'--event-db','--brain-run-id',randomUUID(),'--event-source-id',randomUUID()],f.envelope,
      {ACTIVITY_EVENT_DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:1/cecelia_scratch'}).done;
   expect(out.code).toBe(1);await expect(stat(f.startup)).rejects.toThrow();await expect(stat(f.envelope.input.trace)).rejects.toThrow();
 }finally{await f.cleanup();}
});

test('opt-in必须显式progress receipt，不能以no-op持久化发布START',async()=>{
 const f=await setup();try{
   const out=await f.run(undefined,f.envelope,{},false).done;expect(out.code).toBe(1);expect(out.result.detail).toBe('invalid_cli_argument');
   await expect(stat(f.startup)).rejects.toThrow();await expect(stat(f.envelope.input.trace)).rejects.toThrow();
 }finally{await f.cleanup();}
});
test('startup与progress经目录symlink指向同一路径时执行前拒绝',async()=>{
 const f=await setup();try{
   const alias=join(f.cwd,'alias');await symlink(f.cwd,alias);
   const out=await f.run(['--startup-receipt',join(alias,'progress.json'),'--startup-id',f.id]).done;
   expect(out.code).toBe(1);expect(out.result.detail).toBe('invalid_cli_argument');
   await expect(stat(f.envelope.input.trace)).rejects.toThrow();
 }finally{await f.cleanup();}
});
test('拒绝同路径也不得通过最终progress持久化覆写已有startup凭证',async()=>{
 const f=await setup();try{
   const old='已有凭证不得改\n';await writeFile(f.receipt,old);
   const out=await f.run(['--startup-receipt',f.receipt,'--startup-id',f.id]).done;
   expect(out.code).toBe(1);expect(await readFile(f.receipt,'utf8')).toBe(old);
 }finally{await f.cleanup();}
});

test.each(['duplicate-path-late-existing', 'duplicate-path-first-existing', 'unknown-after-startup', 'duplicate-id-after-startup'])
  ('opt-in非法参数%s不得通过最终progress持久化覆写旧START', async kind => {
    const f = await setup();
    try {
      const old = '旧START原始字节必须保留\n';
      await writeFile(f.receipt, old);
      const args = {
        'duplicate-path-late-existing': ['--startup-receipt', f.startup, '--startup-receipt', f.receipt, '--startup-id', f.id],
        'duplicate-path-first-existing': ['--startup-receipt', f.receipt, '--startup-receipt', f.startup, '--startup-id', f.id],
        'unknown-after-startup': ['--startup-receipt', f.startup, '--startup-id', f.id, '--unknown'],
        'duplicate-id-after-startup': ['--startup-receipt', f.startup, '--startup-id', f.id, '--startup-id', f.id],
      }[kind];
      const out = await f.run(args, {}).done;
      expect(out.code).toBe(1);
      expect(out.result.detail).toBe('invalid_cli_argument');
      expect(await readFile(f.receipt, 'utf8')).toBe(old);
      await expect(stat(f.startup)).rejects.toThrow();
      await expect(stat(f.envelope.input.trace)).rejects.toThrow();
    } finally { await f.cleanup(); }
  });
