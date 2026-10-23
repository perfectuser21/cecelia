import {afterEach,expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {infraBootstrapDatabase} from '../fixtures/infra-bootstrap-db.js';
let f;afterEach(async()=>{await f?.close();f=null;});
function app(options){const a=express();a.use(express.json());a.use('/ci',createImplementationCiRouter({pool:f.createPool(4),bootstrapOptions:options}));return a;}
it('既有infra缺失Activity/ref可经真实HTTP受控初始化且不授执行权',async()=>{
 f=await infraBootstrapDatabase();const response=await request(app(f.options)).post('/ci/infra/bootstrap').send(await f.input());
 expect(response.status,response.body).toBe(201);expect(response.body.receipt).toMatchObject({metadata_only:true,executable:false,runtime_status:'not_evaluated'});
 expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(1);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(1);
 expect((await f.db.query('SELECT current_definition_version_id FROM workflows')).rows[0].current_definition_version_id).toBeNull();
 expect((await f.db.query('SELECT * FROM workflow_definition_versions')).rows).toHaveLength(0);
});

for(const route of [{orchestrator:'skill-relay'},{orchestrator:'foreign'},{pipeline:'kernel-v1'},{canonical_task_type:'dev'}])it('固定原路由合同漂移不授登记权：'+JSON.stringify(route),async()=>{
 f=await infraBootstrapDatabase({route});const input=await f.input();
 const response=await request(app(f.options)).post('/ci/infra/bootstrap').send(input);
 expect(response.status).toBe(403);expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
 expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(0);
});
it('真实并发同键初始化只建一组，丢ACK后的同输入重放不重写receipt',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options);
 const replies=await Promise.all([1,2].map(()=>request(a).post('/ci/infra/bootstrap').send(input)));
 expect(replies.map(r=>r.status).sort()).toEqual([200,201]);
 expect(replies[0].body.receipt).toEqual(replies[1].body.receipt);
 const before=(await f.db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0].result;
 const third=await request(a).post('/ci/infra/bootstrap').send(input);expect(third.status,third.body).toBe(200);
 expect((await f.db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0].result).toEqual(before);
 expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(1);
});
it('真实双PG不同键竞争原CAS只有一个赢家，不覆盖已提交组',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options);
 const replies=await Promise.all(['left','right'].map(client_request_id=>request(a).post('/ci/infra/bootstrap').send({...input,client_request_id})));
 expect(replies.map(r=>r.status).sort()).toEqual([201,409]);expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(1);
});
for(const [field,value] of [['client_request_id',['x']],['client_request_id',{}],['client_request_id',' '],['revision',['a'.repeat(40)]],['expected_registry_sha256',['a'.repeat(64)]],['actor','owner'],['workflow_id','arbitrary']])it('输入不可coerce或夹带授权：'+field+JSON.stringify(value),async()=>{
 f=await infraBootstrapDatabase();const input={...await f.input(),[field]:value};
 const res=await request(app(f.options)).post('/ci/infra/bootstrap').send(input);expect(res.status).toBe(400);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
});
it('内部owner认证不可用body授权或tenant header替代',async()=>{
 f=await infraBootstrapDatabase();const original=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='fixture-only-owner';
 try{const a=app(f.options),input=await f.input();
  expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(401);
  expect((await request(a).post('/ci/infra/bootstrap').set('X-Internal-Token','wrong').send(input)).status).toBe(401);
  expect((await request(a).post('/ci/infra/bootstrap').set('X-Internal-Token','fixture-only-owner').set('X-Tenant-Id','foreign').send(input)).status).toBe(400);
  expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
 }finally{if(original===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=original;}
});
for(const sql of ["UPDATE tasks SET status='blocked' WHERE title='bootstrap'","UPDATE tasks SET claimed_by='other' WHERE title='bootstrap'","UPDATE tasks SET parent_task_id=NULL WHERE title='bootstrap'","UPDATE tasks SET payload='{}' WHERE title='bootstrap'","UPDATE tasks SET status='blocked' WHERE title='parent'"])it('DB实读撤权/父级变化拒绝且零写：'+sql,async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();await f.db.query(sql);
 expect((await request(app(f.options)).post('/ci/infra/bootstrap').send(input)).status).toBe(403);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
});
it('伪造DB task payload中的receipt不能代替append-only原路由事实',async()=>{
 f=await infraBootstrapDatabase({receipt:false});const input=await f.input();
 expect((await request(app(f.options)).post('/ci/infra/bootstrap').send(input)).status).toBe(403);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
});
it('错误CAS零写；既有无ref Activity也拒绝补全',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options);
 expect((await request(a).post('/ci/infra/bootstrap').send({...input,expected_registry_sha256:'a'.repeat(64)})).status).toBe(409);
 await f.db.query("INSERT INTO activities(name,status,workflow_id) SELECT 'orphan','planned',id FROM workflows");
 expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(409);
 expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(0);
});
it('源坏字节、错部署SHA、远端main漂移均不能进入登记写入',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();
 for(const options of [{...f.options,readFile:async(rev,p)=>(await f.options.readFile(rev,p))+'//drift'},{...f.options,revision:'b'.repeat(40)},{...f.options,checkMain:async()=>{throw Error('MAIN_MOVED');}}]){
  expect((await request(app(options)).post('/ci/infra/bootstrap').send(input)).status).toBeGreaterThanOrEqual(400);
  expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
 }
});
it('最后main复核失败真实ROLLBACK，不留下Activity/ref/receipt',async()=>{
 f=await infraBootstrapDatabase();let checks=0;const input=await f.input();
 const res=await request(app({...f.options,checkMain:async()=>{if(++checks===3)throw Error('MAIN_MOVED');}})).post('/ci/infra/bootstrap').send(input);
 expect(checks).toBe(3);expect(res.status).toBe(500);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(0);
 expect((await f.db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0].result).toBeNull();
});
it('同key异输入或已登记后资源漂移均409，保留旧receipt',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options),first=await request(a).post('/ci/infra/bootstrap').send(input);expect(first.status).toBe(201);
 expect((await request(a).post('/ci/infra/bootstrap').send({...input,expected_registry_sha256:'a'.repeat(64)})).status).toBe(409);
 await f.db.query("UPDATE skill_registry SET location='unverified'");expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(409);
 expect((await f.db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0].result.infra_registry_bootstrap).toEqual(first.body.receipt);
});
it('同一infra锁被占用时有界拒绝，不能无限等或写出半组',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();await f.client.query('BEGIN');await f.client.query("SELECT pg_advisory_xact_lock(hashtext('infra-consumer-evidence'))");
 try{const start=Date.now(),res=await request(app(f.options)).post('/ci/infra/bootstrap').send(input);expect(res.status).toBe(500);expect(Date.now()-start).toBeLessThan(9000);}
 finally{await f.client.query('ROLLBACK');}
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
},12000);
it('已存在ref即使inactive也不补全、不覆盖其他关系',async()=>{
 f=await infraBootstrapDatabase();const a=(await f.db.query("INSERT INTO activities(name,status,workflow_id) SELECT 'existing','planned',id FROM workflows RETURNING id")).rows[0];
 await f.db.query("INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,active) SELECT id,'other-slot',$1,1,false FROM workflows",[a.id]);
 const input=await f.input();expect((await request(app(f.options)).post('/ci/infra/bootstrap').send(input)).status).toBe(409);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(1);expect((await f.db.query('SELECT active FROM workflow_activity_refs')).rows).toEqual([{active:false}]);
});
for(const table of ['value_streams','skill_registry'])it('既有父实体缺失不得新造：'+table,async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();await f.db.query('DELETE FROM '+table);
 expect((await request(app(f.options)).post('/ci/infra/bootstrap').send(input)).status).toBe(409);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
});
it('已有task结果字段保持；非法receipt容器拒绝而非覆盖',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options);await f.db.query("UPDATE tasks SET result='[]' WHERE title='bootstrap'");
 expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(409);
 await f.db.query(`UPDATE tasks SET result='{"original_fact":"preserve"}' WHERE title='bootstrap'`);
 expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(201);
 expect((await f.db.query("SELECT result FROM tasks WHERE title='bootstrap'")).rows[0].result.original_fact).toBe('preserve');
});
it('最终PG receipt读回被触发器破坏必须整组回滚',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();
 await f.db.query(`CREATE FUNCTION fixture_corrupt_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.result='{}'::jsonb; RETURN NEW; END $$;
 CREATE TRIGGER fixture_corrupt_receipt BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION fixture_corrupt_receipt()`);
 const res=await request(app(f.options)).post('/ci/infra/bootstrap').send(input);expect(res.status).toBe(409);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);expect((await f.db.query('SELECT * FROM workflow_activity_refs')).rows).toHaveLength(0);
 expect((await f.db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0].result).toBeNull();
});
it('source能力不可由JSON或跨请求/第二次消费伪造',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input();
 const {prepareInfraBootstrapSource,consumeInfraBootstrapSource}=await import('../../lib/infra-bootstrap-source.js');
 expect(()=>consumeInfraBootstrapSource({source:{verified:true}},input)).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 const cap=await prepareInfraBootstrapSource(input,f.options);expect(()=>consumeInfraBootstrapSource(cap,{...input,client_request_id:'foreign'})).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 expect(()=>consumeInfraBootstrapSource(cap,input)).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 const valid=await prepareInfraBootstrapSource(input,f.options);consumeInfraBootstrapSource(valid,input);expect(()=>consumeInfraBootstrapSource(valid,input)).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
});
for(const path of ['packages/brain/src/workflow-authoring/fixed-git-source.js','packages/brain/scripts/sync-steps-from-workspace.mjs','packages/brain/src/middleware/internal-auth.js'])it('关键取源/摘要/鉴权依赖字节漂移不能自证：'+path,async()=>{
 f=await infraBootstrapDatabase();const options={...f.options,readFile:async(rev,p)=>(await f.options.readFile(rev,p))+(p===path?'// drift':'')};
 expect((await request(app(options)).post('/ci/infra/bootstrap').send(await f.input())).status).toBe(409);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(0);
});
it('任务账中的旧receipt不能夹带执行成功或伪来源重新返回',async()=>{
 f=await infraBootstrapDatabase();const input=await f.input(),a=app(f.options);expect((await request(a).post('/ci/infra/bootstrap').send(input)).status).toBe(201);
 await f.db.query(`UPDATE tasks SET result=jsonb_set(result,'{infra_registry_bootstrap,executable}','true') WHERE title='bootstrap'`);
 const response=await request(a).post('/ci/infra/bootstrap').send(input);expect(response.status).toBe(409);
 expect((await f.db.query('SELECT * FROM activities')).rows).toHaveLength(1);
});
