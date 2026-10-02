import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createOnboardingService } from '../service.js';

const database = process.env.NODE_ONBOARDING_TEST_DB;
const suite = database ? describe : describe.skip;
suite('既有机器采用原UUID（真实PG）', () => {
  let admin, db, service, schema;
  const input = { name: 'vps-hk', address: '192.0.2.42', ssh_user: 'root', ssh_port: 22,
    credential_ref: 'op://CS/node/private key', host_key_fingerprint: `SHA256:${'b'.repeat(43)}`,
    role: 'observer', region: 'HK' };
  const id = randomUUID();
  const original = { public_ip: input.address, tailscale_ip: '100.100.1.2', ssh_alias: 'hk-vps',
    services: ['gateway'], accounts: ['existing'], role: '公网入口 & AI 执行节点', hardware: '原硬件', note: '保留' };
  beforeAll(async () => {
    if (new URL(database).pathname !== '/cecelia_scratch' && !(process.env.CI === 'true' && new URL(database).pathname === '/cecelia_test')) throw Error('scratch only');
    schema = `adopt_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: database }); await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: database, options: `-c search_path=${schema},public` });
    await db.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,payload jsonb,result jsonb,error_message text,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz,parent_task_id uuid,claimed_by text,claimed_at timestamptz,started_at timestamptz);
      CREATE TABLE system_registry(id uuid PRIMARY KEY,type text,name text,description text,status text,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(type,name));
      CREATE TABLE execution_nodes(machine_registry_id uuid PRIMARY KEY,current_version_id uuid)`);
    service = createOnboardingService({ pool: db, createTask: async args => ({ success:true,task:(await args.db.query(
      'INSERT INTO tasks(id,title,task_type,status,payload,parent_task_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [randomUUID(),args.title,args.task_type,args.status??'queued',JSON.stringify(args.payload),args.parent_task_id??null])).rows[0] }) });
  });
  beforeEach(async () => {
    await db.query('TRUNCATE tasks,system_registry');
    await db.query("INSERT INTO system_registry(id,type,name,status,description,metadata) VALUES($1,'machine',$2,'legacy-status','原说明',$3)",[id,input.name,JSON.stringify(original)]);
  });
  afterAll(async () => { await db?.end(); if(admin){if(schema)await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();} });
  const machine = async () => (await db.query('SELECT * FROM system_registry WHERE id=$1',[id])).rows[0];
  async function finish(view, valid=true) {
    const report={type:'node_onboarding_receipt',id:view.id,mode:'enroll',name:input.name,verified:valid,service:{enabled:true,active:true},health:{
      schema_version:1,node_id:view.id,agent_version:'1',observed_at:new Date().toISOString(),boot_id:id,sequence:2,hostname:input.name,os:'linux',
      janitor:{mode:'observe',policy:'owned-cache-only'},capabilities:{collector:true,janitor:true,execution:false},
      resources:{memory_total_bytes:8e9,memory_available_bytes:4e9,cpu_load_1m:0.2,cpu_cores:4,disk_free_bytes:10e9,disk_total_bytes:40e9}}};
    await db.query("UPDATE tasks SET status='completed',completed_at=now(),result=$2 WHERE id=$1",[view.task_id,JSON.stringify({script:{exit_code:0,stdout:JSON.stringify(report)}})]);
  }
  it('同名可信公网地址接入保留UUID和台账，默认observer不继承文字执行角色',async()=>{
    const view=await service.create(input,randomUUID());expect(view.id).toBe(id);expect((await machine()).metadata).toEqual(original);
    await finish(view);expect((await service.get(id)).status).toBe('completed');
    const row=await machine();expect(row).toMatchObject({id,status:'legacy-status',description:'原说明'});
    expect(row.metadata).toMatchObject({...original,role:'observer',onboarding:{id,state:'managed'},node_health:{node_id:id}});
    expect((await db.query('SELECT id FROM system_registry')).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(0);
    await service.get(id);expect((await machine()).metadata.onboarding.task_id).toBe(view.task_id);
  });
  it('同机不同可信地址并发只能登记一个原UUID任务',async()=>{
    const results=await Promise.allSettled([service.create(input,randomUUID()),service.create({...input,address:original.tailscale_ip},randomUUID())]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')[0].reason.status).toBe(409);
    expect((await db.query('SELECT payload FROM tasks')).rows).toHaveLength(1);
    expect((await db.query('SELECT payload FROM tasks')).rows[0].payload.node_onboarding.id).toBe(id);
  });
  it('同一请求不同幂等键并发复用原UUID任务',async()=>{
    const [a,b]=await Promise.all([service.create(input,randomUUID()),service.create(input,randomUUID())]);
    expect(a.id).toBe(id);expect(b.task_id).toBe(a.task_id);
    expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(1);
  });
  it.each([original.public_ip,original.tailscale_ip,original.ssh_alias])('更名复用既有地址 %s 不能另建机器',async address=>{
    await expect(service.create({...input,name:'another-machine',address},randomUUID())).rejects.toMatchObject({status:409});
    expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(0);
  });
  it('名称与地址分别属于两台机器时拒绝',async()=>{
    await db.query("INSERT INTO system_registry(id,type,name,metadata) VALUES($1,'machine','other-machine',$2)",[randomUUID(),JSON.stringify({address:input.address})]);
    await expect(service.create(input,randomUUID())).rejects.toMatchObject({status:409});
  });
  it.each(['address','name','replacement'])('验收前台账身份变化 %s 拒绝覆盖',async change=>{
    const v=await service.create(input,randomUUID());await finish(v);
    if(change==='address')await db.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{public_ip}','\"192.0.2.99\"') WHERE id=$1",[id]);
    if(change==='name')await db.query("UPDATE system_registry SET name='renamed-node' WHERE id=$1",[id]);
    if(change==='replacement'){await db.query('DELETE FROM system_registry WHERE id=$1',[id]);await db.query("INSERT INTO system_registry(id,type,name,metadata) VALUES($1,'machine',$2,$3)",[randomUUID(),input.name,JSON.stringify(original)]);}
    expect((await service.get(id)).status).toBe('failed');
    expect((await db.query("SELECT id FROM system_registry WHERE metadata ? 'onboarding'")).rows).toHaveLength(0);
  });
  it('失败回执不改台账，允许修正SSH配置复用原UUID重试',async()=>{
    const v=await service.create(input,randomUUID());await finish(v,false);expect((await service.get(id)).status).toBe('failed');
    expect((await machine()).metadata).toEqual(original);
    const retried=await service.create({...input,ssh_user:'operator'},randomUUID());expect(retried.id).toBe(id);expect(retried.task_id).not.toBe(v.task_id);
    await finish(retried);expect((await service.get(id)).status).toBe('completed');
  });
  it('完成对账与页面读取并发保持原UUID成功且保留期间新增台账资料',async()=>{
    const v=await service.create(input,randomUUID());await finish(v);
    await db.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{notes}','\"新增备注\"') WHERE id=$1",[id]);
    await Promise.all([service.reconcile(),service.get(id)]);
    expect((await service.get(id)).status).toBe('completed');expect((await machine()).metadata.notes).toBe('新增备注');
  });
  it('失败后台账地址变化，原重试入口拒绝再次发送SSH任务',async()=>{
    const v=await service.create(input,randomUUID());await finish(v,false);await service.get(id);
    await db.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{public_ip}','\"192.0.2.99\"') WHERE id=$1",[id]);
    await expect(service.retry(id)).rejects.toMatchObject({status:409});
    expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(1);
  });
  it('同名但未知地址不能建立新的接入任务',async()=>{
    await expect(service.create({...input,address:'192.0.2.100'},randomUUID())).rejects.toMatchObject({status:409});
    expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(0);
  });
  it('明确选择worker才登记原UUID下的Linux验收子任务，保留原服务台账',async()=>{
    const v=await service.create({...input,role:'worker'},randomUUID());await finish(v);await service.reconcile();
    const tasks=(await db.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows;expect(tasks).toHaveLength(1);
    expect(tasks[0].parent_task_id).toBe(v.task_id);expect(tasks[0].payload.linux_onboarding.machine_registry_id).toBe(id);
    expect((await machine()).metadata.services).toEqual(original.services);
  });
});
