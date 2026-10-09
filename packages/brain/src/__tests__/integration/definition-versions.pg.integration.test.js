import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import express from 'express';
import pg from 'pg';
import {DB_DEFAULTS} from '../../db-config.js';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { versionsDatabase,seedWorkflows } from '../fixtures/definition-versions-db.js';
import { contractsFixture } from '../fixtures/shared-activity-contracts.js';
import { snapshotDefinitions } from '../../lib/definition-versions.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
const holder=vi.hoisted(()=>({db:null}));
vi.mock('../../db.js',()=>({default:{query:(...a)=>holder.db.query(...a),connect:(...a)=>holder.db.connect(...a)}}));
vi.mock('../../alerting.js',()=>({raise:vi.fn()}));
import routes from '../../routes/workflows.js';
let fixture,db,ids;
beforeEach(async()=>{fixture=await versionsDatabase();db=fixture.db;holder.db=db;ids=await seedWorkflows(db);});
afterEach(async()=>{if(fixture)await fixture.close();});
async function counts(){return (await db.query(`SELECT (SELECT count(*)::int FROM activity_definition_versions) activities,(SELECT count(*)::int FROM workflow_definition_versions) workflows`)).rows[0];}
async function versions(){return (await db.query('SELECT * FROM activity_definition_versions ORDER BY id')).rows;}
describe('不可变能力定义版本',()=>{
  it('迁移幂等，同内容复用版本，共享更新仅增加一活动和两个workflow版本且旧快照不变',async()=>{
    await expect(fixture.migrate()).resolves.toBeUndefined();await fixture.migrate();
    const f=contractsFixture();await syncActivityContracts(db,f);expect(await counts()).toEqual({activities:9,workflows:2});
    const old=await versions();await syncActivityContracts(db,f);expect(await counts()).toEqual({activities:9,workflows:2});
    f.docs.keyword_acquisition.activities[0].name='新版预检';f.refresh();await syncActivityContracts(db,f);
    expect(await counts()).toEqual({activities:10,workflows:4});
    for(const row of old)expect((await db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[row.id])).rows[0]).toEqual(row);
  });
  it('真实数据库拒绝快照UPDATE/DELETE和跨对象当前指针',async()=>{
    await fixture.migrate();await syncActivityContracts(db,contractsFixture());
    const rows=await versions();
    await expect(db.query('UPDATE activity_definition_versions SET payload=$2 WHERE id=$1',[rows[0].id,{}])).rejects.toThrow('不可变');
    await expect(db.query('DELETE FROM activity_definition_versions WHERE id=$1',[rows[0].id])).rejects.toThrow('不可变');
    await expect(db.query('UPDATE journey_steps SET current_definition_version_id=$1 WHERE id=$2',[rows[0].id,rows[1].activity_id])).rejects.toThrow();
    const w=(await db.query('SELECT * FROM workflow_definition_versions LIMIT 1')).rows[0];
    await expect(db.query('UPDATE workflow_definition_versions SET payload=$2 WHERE id=$1',[w.id,{}])).rejects.toThrow('不可变');
    await expect(db.query('DELETE FROM workflow_definition_versions WHERE id=$1',[w.id])).rejects.toThrow('不可变');
    await expect(db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[w.id,w.workflow_id===ids.keyword?ids.benchmark:ids.keyword])).rejects.toThrow();
  });
  it('快照末尾失败整批定义/引用/版本回滚',async()=>{
    await fixture.migrate();await db.query(`CREATE FUNCTION reject_snapshot() RETURNS trigger AS $$BEGIN RAISE EXCEPTION '快照失败';END$$ LANGUAGE plpgsql;CREATE TRIGGER reject_snapshot BEFORE INSERT ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION reject_snapshot()`);
    await expect(syncActivityContracts(db,contractsFixture())).rejects.toThrow('快照失败');
    expect(await counts()).toEqual({activities:0,workflows:0});
    expect((await db.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM workflow_activity_refs')).rows[0].n).toBe(0);
  });
  it('历史HTTP按指定版本返回旧契约与精确Activity版本；错误对象404',async()=>{
    await fixture.migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    const old=(await db.query('SELECT current_definition_version_id id FROM workflows WHERE id=$1',[ids.keyword])).rows[0].id;
    f.docs.keyword_acquisition.activities[0].name='新版';f.refresh();await syncActivityContracts(db,f);
    const app=express();app.use('/api/brain',routes);
    const history=await request(app).get(`/api/brain/workflows/${ids.keyword}/versions/${old}`);expect(history.status,history.body.error).toBe(200);
    const a=history.body.version.payload.activities[0];expect(a.activity_version_id).toBeTruthy();
    const activity=await request(app).get(`/api/brain/activities/${a.activity_id}/versions/${a.activity_version_id}`);
    expect(activity.body.version.payload.contract.name).toBe('preflight');
    expect((await request(app).get(`/api/brain/workflows/${ids.benchmark}/versions/${old}`)).status).toBe(404);
    expect((await request(app).get(`/api/brain/workflows/${randomUUID()}/versions`)).status).toBe(404);
  });
  it('Skill切换Code保持Activity UUID并生成新版本，固定revision引用在写事务前验证',async()=>{
    await fixture.migrate();const f=contractsFixture(),rev='c'.repeat(40);
    f.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'skill',repo:'org/repo',path:'skills/check/SKILL.md',revision:rev}];f.refresh();
    const readBinding=vi.fn(async()=> '---\nname: check\nversion: 1.0.0\n---\n# 预检');await syncActivityContracts(db,{...f,readBinding});
    const before=(await db.query("SELECT id,current_definition_version_id FROM journey_steps WHERE activity_key='preflight'")).rows[0];
    f.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo:'org/repo',path:'src/check.js',revision:rev}];f.refresh();await syncActivityContracts(db,{...f,readBinding});
    const after=(await db.query('SELECT id,current_definition_version_id FROM journey_steps WHERE id=$1',[before.id])).rows[0];
    expect(after.id).toBe(before.id);expect(after.current_definition_version_id).not.toBe(before.current_definition_version_id);
    expect(readBinding).toHaveBeenCalledWith(expect.objectContaining({revision:rev,path:'src/check.js'}));
    const prior=await counts();f.docs.keyword_acquisition.activities[0].implementation_bindings[0].revision='main';f.refresh();
    await expect(syncActivityContracts(db,{...f,readBinding})).rejects.toThrow('revision');expect(await counts()).toEqual(prior);
  });
  it.each([
    ['skill', 'skills/check/SKILL.md', '---\nname: check\nversion: 1.0.0\n---\n# 预检\n'],
    ['skill', 'skills/check/SKILL.md', '---\r\nname: check\r\nversion: 1.0.0\r\n---\r\n# 预检\r\n'],
    ['code', 'src/check.js', '\n  export const ready = true;\n\n'],
  ])('默认GitHub读取保留%s原文空白及digest，只有HEAD响应裁剪',async(kind,path,content)=>{
    await fixture.migrate();const f=contractsFixture(),revision='c'.repeat(40),head='a'.repeat(40);
    const sha256=createHash('sha256').update(content).digest('hex');
    f.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind,repo:'org/repo',path,revision,sha256,digest:`sha256:${sha256}`}];
    f.refresh();const fetch=f.fetchFn;
    f.fetchFn=async url=>url.includes('/repos/org/repo/')?{ok:true,text:async()=>content}
      :url.includes('/commits/main')?{ok:true,text:async()=>`${head}\n`}:fetch(url);
    await expect(syncActivityContracts(db,f)).resolves.toMatchObject({head_sha:head});
    const saved=(await db.query(`SELECT v.payload,v.source_commit FROM journey_steps a JOIN activity_definition_versions v
      ON v.id=a.current_definition_version_id WHERE a.capability_key='keyword_acquisition' AND a.activity_key='preflight'`)).rows[0];
    expect(saved.source_commit).toBe(head);
    expect(saved.payload.implementation_bindings[0]).toMatchObject({kind,revision,content_sha256:sha256,digest:`sha256:${sha256}`,status:'verified'});
  });
  it('本仓contract实现由默认读取器固定到同一来源SHA，真实数据库保存字节摘要及原始声明',async()=>{
    await fixture.migrate();const f=contractsFixture(),head='a'.repeat(40);
    const path='services/phone-adb-controller/preflight.sh',content='#!/bin/bash\n\nprintf ready\n';
    f.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo:'perfectuser21/zenithjoy-workspace',path,revision:'contract'}];
    f.refresh();const fetch=f.fetchFn,seen=[];
    f.fetchFn=async url=>{
      if(url.includes(`/contents/${path}`)){seen.push(url);return {ok:true,text:async()=>content};}
      return fetch(url);
    };
    await syncActivityContracts(db,f);
    expect(seen.length).toBeGreaterThan(0);expect(seen.every(url=>new URL(url).searchParams.get('ref')===head)).toBe(true);
    const saved=(await db.query(`SELECT v.payload,v.source_commit FROM journey_steps a JOIN activity_definition_versions v
      ON v.id=a.current_definition_version_id WHERE a.capability_key='keyword_acquisition' AND a.activity_key='preflight'`)).rows[0];
    expect(saved.source_commit).toBe(head);
    expect(saved.payload.implementation_bindings[0]).toMatchObject({revision:head,raw:{revision:'contract'},status:'verified',content_sha256:createHash('sha256').update(content).digest('hex')});
  });

  it('相同内容新commit产生可追溯新快照，当前引用的来源commit与版本一致',async()=>{
    await fixture.migrate();const f=contractsFixture();await syncActivityContracts(db,f);const original=await versions();
    const fetch=f.fetchFn;f.fetchFn=async url=>url.includes('/commits/main')?{ok:true,text:async()=> 'd'.repeat(40)}:fetch(url);
    await syncActivityContracts(db,f);expect(await counts()).toEqual({activities:18,workflows:4});
    const rows=(await db.query(`SELECT r.source_commit,v.source_commit version_commit FROM workflow_activity_refs r JOIN activity_definition_versions v ON v.id=r.activity_definition_version_id WHERE r.active`)).rows;
    expect(rows.every(r=>r.source_commit===r.version_commit&&r.version_commit==='d'.repeat(40))).toBe(true);
    for(const row of original)expect((await db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[row.id])).rows[0]).toEqual(row);
  });

  it('历史快照保存引用UUID与Step身份/未注册locator；数据库拒绝错配引用版本',async()=>{
    await fixture.migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    const a=(await db.query("SELECT id FROM journey_steps WHERE activity_key='preflight'")).rows[0];const step=randomUUID();
    await db.query(`INSERT INTO steps(id,activity_id,step_order,key,activity_key) VALUES($1,$2,1,'preflight_step','preflight')`,[step,a.id]);
    await syncActivityContracts(db,f);
    const av=(await db.query('SELECT v.* FROM journey_steps a JOIN activity_definition_versions v ON v.id=a.current_definition_version_id WHERE a.id=$1',[a.id])).rows[0];
    expect(av.payload.steps).toHaveLength(1);
    expect(av.payload.steps[0]).toMatchObject({step_id:step,locator:{activity_id:a.id,step_key:'preflight_step'}});
    const wv=(await db.query('SELECT v.* FROM workflows w JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id WHERE w.id=$1',[ids.keyword])).rows[0];
    expect(wv.payload.activities.every(r=>r.reference_id)).toBe(true);
    const refs=(await db.query('SELECT * FROM workflow_activity_refs WHERE active ORDER BY workflow_id,sequence_no')).rows;
    const other=refs.find(r=>r.activity_id!==a.id);
    await expect(db.query('UPDATE workflow_activity_refs SET activity_definition_version_id=$1 WHERE id=$2',[av.id,other.id])).rejects.toThrow();
    await expect(db.query(`INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,contract_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$3,'org/repo','file',$4)`,[ids.keyword,{activities:[{activity_id:other.activity_id,activity_version_id:av.id}]},'e'.repeat(64),'a'.repeat(40)])).rejects.toThrow('对象错配');
  });

  it.each(['missing_document','wrong_document','wrong_commit','wrong_repo'])('公共快照写入器拒绝%s，现有版本与指针不变',async mode=>{
    await fixture.migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    const existing=await versions(),before=await counts();
    const refsBefore=(await db.query('SELECT * FROM workflow_activity_refs ORDER BY id')).rows;
    const options={workflowIds:[ids.keyword],source:{repo:'perfectuser21/zenithjoy-workspace',path:'product-map/contracts/keyword_acquisition.yaml',commit:'a'.repeat(40)},bindingsByActivity:new Map(existing.map(v=>[v.activity_id,v.payload.implementation_bindings])),documentsByWorkflow:new Map([[ids.keyword,f.docs.keyword_acquisition]])};
    if(mode==='missing_document')delete options.documentsByWorkflow;
    if(mode==='wrong_document')options.documentsByWorkflow.set(ids.keyword,f.docs.benchmark_link_acquisition);
    if(mode==='wrong_commit')options.source.commit='f'.repeat(40);
    if(mode==='wrong_repo')options.source.repo='wrong/repo';
    await expect(snapshotDefinitions(db,options)).rejects.toThrow(/完整契约|契约身份|来源不匹配/);
    expect(await counts()).toEqual(before);expect(await versions()).toEqual(existing);
    expect((await db.query('SELECT * FROM workflow_activity_refs ORDER BY id')).rows).toEqual(refsBefore);
  });
  it('数据库拒绝空契约和payload自身份错配',async()=>{
    await fixture.migrate();
    const insert=payload=>db.query(`INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,contract_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$3,'org/repo','file',$4)`,[ids.keyword,payload,'0'.repeat(64),'a'.repeat(40)]);
    await expect(insert({workflow_id:ids.keyword,contract:null,activities:[]})).rejects.toThrow();
    await expect(insert({workflow_id:ids.benchmark,contract:{},activities:[]})).rejects.toThrow();
  });

});

it('私有fixture真实建表和外键只归己schema，无public复制且close释放多连接后删除自己的schema',async()=>{
 const audit=[];const original=pg.Client.prototype.query;const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(...args){audit.push(typeof args[0]==='string'?args[0]:args[0].text);return original.apply(this,args);});
 let own;try{
  own=await versionsDatabase();expect((await own.db.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema:own.schema});
  const foreign=(await own.db.query("SELECT target.nspname FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid JOIN pg_namespace origin ON origin.oid=source.relnamespace JOIN pg_class referenced ON referenced.oid=c.confrelid JOIN pg_namespace target ON target.oid=referenced.relnamespace WHERE c.contype='f' AND origin.nspname=current_schema() AND target.nspname<>current_schema()")).rows;expect(foreign).toEqual([]);
  const pool=own.createPool(2),a=await pool.connect(),b=await pool.connect();try{expect((await a.query('SELECT pg_backend_pid() id')).rows[0].id).not.toBe((await b.query('SELECT pg_backend_pid() id')).rows[0].id);}finally{a.release();b.release();}
  await own.close();expect((await db.query('SELECT nspname FROM pg_namespace WHERE nspname=$1',[own.schema])).rows).toEqual([]);
  expect(audit.some(q=>/LIKE\s+public\.|SET\s+search_path\s+TO\s+public|CREATE\s+(?:EXTENSION|DATABASE)/i.test(q))).toBe(false);
 }finally{spy.mockRestore();await own?.close();}
});
it('私有fixture真实初始化SQL失败清理自己的schema与client，真实迁移台账和生成列保留',async()=>{
 let failedSchema;await expect(privateFixtureDatabase('fixturefailure',async client=>{failedSchema=(await client.query('SELECT current_schema() name')).rows[0].name;await client.query('CREATE TABLE broken (');})).rejects.toMatchObject({code:'42601'});
 expect((await db.query('SELECT nspname FROM pg_namespace WHERE nspname=$1',[failedSchema])).rows).toEqual([]);
 expect((await db.query("SELECT version FROM schema_version ORDER BY version")).rows.map(r=>r.version)).toEqual(['059','494','495']);
 expect((await db.query("SELECT is_generated FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='spans' AND column_name='duration_ms'")).rows).toEqual([{is_generated:'ALWAYS'}]);
 const root=(await db.query('SELECT id FROM journeys WHERE parent_journey_id IS NULL LIMIT 1')).rows[0].id;await expect(db.query("INSERT INTO workflows(capability_id,key,name,channel) VALUES($1,'invalid-root','wrong','fixture')",[root])).rejects.toThrow('must reference a capability');
});
