import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { versionsDatabase,seedWorkflows } from '../fixtures/definition-versions-db.js';
import { contractsFixture } from '../fixtures/shared-activity-contracts.js';
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
    const readBinding=vi.fn(async()=> '# 预检');await syncActivityContracts(db,{...f,readBinding});
    const before=(await db.query("SELECT id,current_definition_version_id FROM journey_steps WHERE activity_key='preflight'")).rows[0];
    f.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo:'org/repo',path:'src/check.js',revision:rev}];f.refresh();await syncActivityContracts(db,{...f,readBinding});
    const after=(await db.query('SELECT id,current_definition_version_id FROM journey_steps WHERE id=$1',[before.id])).rows[0];
    expect(after.id).toBe(before.id);expect(after.current_definition_version_id).not.toBe(before.current_definition_version_id);
    expect(readBinding).toHaveBeenCalledWith(expect.objectContaining({revision:rev,path:'src/check.js'}));
    const prior=await counts();f.docs.keyword_acquisition.activities[0].implementation_bindings[0].revision='main';f.refresh();
    await expect(syncActivityContracts(db,{...f,readBinding})).rejects.toThrow('revision');expect(await counts()).toEqual(prior);
  });
});
