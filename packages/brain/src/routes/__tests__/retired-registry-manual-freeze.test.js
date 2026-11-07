import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const io = vi.hoisted(() => ({ query: vi.fn(), gate: vi.fn(), release: vi.fn(), spawn: vi.fn() }));
vi.mock('../../db.js', () => ({default:{query:io.query}}));
vi.mock('../../runtime-safety.js', async original => ({...await original(),assertExternalExecutionAllowed:vi.fn()}));
vi.mock('../../execution-directory/legacy-relay.js', () => ({withLegacyRelayExecution:async (_identity,run)=>run()}));
vi.mock('child_process', () => ({spawn:io.spawn,exec:vi.fn(),execFile:vi.fn(),execSync:vi.fn()}));
vi.mock('fs/promises', () => ({mkdir:vi.fn(),writeFile:vi.fn(),access:vi.fn()}));
vi.mock('fs', async original => {
  const actual=await original();
  const {resolve}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const root=resolve(process.cwd(),'../..');
  return {...actual,readdirSync:vi.fn(()=>[]),existsSync:vi.fn(()=>false),unlinkSync:vi.fn(),
    readFileSync:vi.fn((file,...args)=>{
      const target=file instanceof URL?fileURLToPath(file):resolve(String(file));
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || /credential|auth\.json/.test(target)) throw Error('禁止仓外文件/凭据读取');
      return actual.readFileSync(file,...args);
    })};
});
vi.mock('../../learning-retriever.js', () => ({buildLearningContext:async()=>''}));
vi.mock('../../anchor-check.js', () => ({checkAnchor:()=>({blocked:false})}));
vi.mock('../../lib/manual-dispatch-device-gate.js', () => ({
  checkDeviceLockForManualDispatch:(...args)=>io.gate(...args),
  releaseDeviceLockNonFatal:(...args)=>io.release(...args),
}));
vi.mock('../../executor.js', async original => ({...await original(),checkCeceliaRunAvailable:async()=>({available:true})}));

describe('手动审查预检后的账本并发变化', () => {
  let app, resetBindings, task, registry;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch',vi.fn(()=>{throw Error('禁止真实网络')}));
    resetBindings=(await import('../../lib/skill-binding-registry.js'))._resetSkillBindingCacheForTest;
    resetBindings();
    task={id:'manual-registry',title:'扫描',task_type:'architecture_scan',status:'queued',claimed_by:null,payload:{device_serial:'device-a'}};
    registry=[{name:'architect',status:'active',task_types:['architecture_scan'],dispatch_command:'/architect scan'}];
    io.query.mockImplementation(async sql => {
      if (String(sql).includes('FROM tasks WHERE id = $1')) return {rows:[{...structuredClone(task),dispatch_row_version:'7'}]};
      if (String(sql).includes('FROM skill_registry')) return {rows:registry};
      if (String(sql).includes('RETURNING claimed_at::text')) return {rows:[{claim_stamp:'2026-11-07 00:00:00.123456+00',claim_version:'8'}],rowCount:1};
      if (String(sql).includes("UPDATE tasks SET status='in_progress'")) return {rows:[{id:task.id,started_version:'9'}],rowCount:1};
      if (String(sql).includes("SELECT * FROM tasks WHERE id=$1 AND status='in_progress'")) return {rows:[{...structuredClone(task),status:'in_progress'}]};
      return {rows:[],rowCount:0};
    });
    io.gate.mockImplementation(async () => {
      registry=[{name:'decomp',status:'deprecated',task_types:['architecture_scan'],dispatch_command:null}];
      resetBindings();
      return {pass:true,acquired:true};
    });
    const stream={on:vi.fn()};
    io.spawn.mockReturnValue({pid:12,stdout:stream,stderr:stream,on:vi.fn(),unref:vi.fn()});
    app=express(); app.use(express.json());
    app.use('/api/brain',(await import('../tasks.js')).default);
    app.use('/api/brain',(await import('../execution.js')).default);
  });
  afterAll(()=>vi.unstubAllGlobals());

  for (const endpoint of ['task','dispatch-now']) {
    it(`${endpoint}：只启动预检已选的安全技能，不释放同任务设备锁`,async()=>{
      const r=endpoint==='task' ? await request(app).post('/api/brain/tasks/manual-registry/dispatch').send({})
        : await request(app).post('/api/brain/dispatch-now').send({task_id:'manual-registry'});
      expect([200,202]).toContain(r.status);
      expect(io.spawn).toHaveBeenCalledOnce();
      expect(io.spawn.mock.calls[0][1].at(-1)).toMatch(/^\/architect scan\b/);
      expect(io.spawn.mock.calls[0][1].at(-1)).not.toMatch(/^\/decomp(?:\s|$)/);
      expect(io.release).not.toHaveBeenCalled();
    });
  }
  it('dispatch-now 对连续请求限流，在查询数据库之前拒绝超额请求',async()=>{
    io.query.mockClear();
    let limited=false;
    for(let i=0;i<305;i++) {
      const result=await request(app).post('/api/brain/dispatch-now').send({});
      if(result.status===429) {limited=true;break;}
      expect(result.status).toBe(400);
    }
    expect(limited).toBe(true);
    expect(io.query).not.toHaveBeenCalled();
  });
});
