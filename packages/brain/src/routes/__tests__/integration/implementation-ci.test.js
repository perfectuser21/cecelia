import { afterEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { implementationImpactDatabase,IMPACT_REPO } from '../../../__tests__/fixtures/implementation-impact-db.js';
import { implementationRefreshDatabase } from '../../../__tests__/fixtures/implementation-refresh-db.js';
const {createImplementationCiRouter}=await import('../../implementation-ci.js').catch(()=>({}));
let fixture;afterEach(async()=>{await fixture?.close();fixture=null;});
it('真实HTTP固定版本导出及缺scope缺口；输入数组不允许隐式regex coercion',async()=>{
  expect(createImplementationCiRouter).toBeTypeOf('function');fixture=await implementationImpactDatabase();
  const app=express();app.use(express.json());app.use('/api/brain/implementation-ci',createImplementationCiRouter({pool:fixture.db}));
  const response=await request(app).get('/api/brain/implementation-ci/snapshot').query({scope:'phones',repo:IMPACT_REPO,revision:'a'.repeat(40)});
  expect(response.status,response.body).toBe(200);expect(response.body.snapshot.definitions.workflows).toHaveLength(2);
  const missing=await request(app).get('/api/brain/implementation-ci/snapshot').query({scope:'zenithjoy',repo:IMPACT_REPO,revision:'a'.repeat(40)});
  expect(missing.body.snapshot.status).toBe('unknown');
  const invalid=await request(app).get(`/api/brain/implementation-ci/snapshot?scope=phones&repo=${IMPACT_REPO}&revision[]=${'a'.repeat(40)}`);
  expect(invalid.status).toBe(400);
});

function concurrentRefresh(f,waitMs=1000){
 const app=express();app.use(express.json());
 for(const route of ['a','b'])app.use(`/${route}`,createImplementationCiRouter({pool:f.db,refreshOptions:f.options({waitMs})}));
 return ['a','b'].map(route=>request(app).post(`/${route}/refresh`).send(f.query).then(r=>r));
}
it('双PG同M竞争跨定义/manifest窗口：只读复用完整赢家快照，不重复同步',async()=>{
 fixture=await implementationRefreshDatabase();const jobs=concurrentRefresh(fixture);let settled=0;
 jobs.forEach(p=>p.then(()=>settled++));
 try{
  await fixture.atWindow;
  // 此时赢家已提交定义并释放事务，地图仍M1；等待者绝不能把它当完整M2返回。
  const {exportImplementationSnapshot}=await import('../../../lib/implementation-ci-snapshot.js');
  const during=await exportImplementationSnapshot(fixture.db,fixture.query);
  expect(during.status).toBe('unknown');expect(during.gaps).toContainEqual(expect.objectContaining({code:'manifest_source_mismatch'}));
  await new Promise(r=>setTimeout(r,100));expect(settled).toBe(0);
  fixture.release();const replies=await Promise.all(jobs);
  expect(replies.map(r=>r.status)).toEqual([200,200]);
  for(const r of replies){expect(r.body.snapshot).toMatchObject({...fixture.query,status:'verified',gaps:[]});}
  expect(replies[0].body.snapshot.definitions).toEqual(replies[1].body.snapshot.definitions);
  expect(fixture.stats().contractReads).toBe(2);
  expect((await fixture.db.query('SELECT contract_sync_revision FROM workflows')).rows.map(r=>r.contract_sync_revision)).toEqual(['2','2']);
 }finally{fixture.release();await Promise.allSettled(jobs);}
});
it('CAS等待到期明确409，仍无重复同步或把unknown当成功',async()=>{
 fixture=await implementationRefreshDatabase();const jobs=concurrentRefresh(fixture,0);
 try{await fixture.atWindow;const loser=await Promise.race(jobs);
  expect(loser.status).toBe(409);expect(loser.body.error.code).toBe('ACTIVITY_CONTRACT_SNAPSHOT_CHANGED');
  expect(fixture.stats().contractReads).toBe(2);
 }finally{fixture.release();await Promise.allSettled(jobs);}
});
it.each(['waiting','verified'])('复用期间%s阶段main前移必须409，不能换SHA继续',async phase=>{
 fixture=await implementationRefreshDatabase(phase==='verified'?{manifestRevision:'b'.repeat(40)}:{});
 if(phase==='verified')fixture.onRead(()=>fixture.setMain('c'.repeat(40)));
 const jobs=concurrentRefresh(fixture);
 try{await fixture.atWindow;if(phase==='waiting')fixture.setMain('c'.repeat(40));
  const loser=await Promise.race(jobs);expect(loser.status).toBe(409);expect(loser.body.error.code).toBe('IMPLEMENTATION_CI_MAIN_MOVED');
  expect(fixture.stats().contractReads).toBe(2);
 }finally{fixture.release();await Promise.allSettled(jobs);}
});
it('等待期间规范父级变化仍拒绝，不以已提交定义冒完整映射',async()=>{
 fixture=await implementationRefreshDatabase();const jobs=concurrentRefresh(fixture);
 try{await fixture.atWindow;await fixture.db.query("UPDATE journeys SET parent_journey_id=NULL WHERE id='a1000000-0000-4000-8000-000000000001'");
  const loser=await Promise.race(jobs);expect(loser.status).toBe(409);expect(loser.body.error.code).toBe('IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED');
 }finally{fixture.release();await Promise.allSettled(jobs);}
});
it('普通取源错误保持失败，不进入CAS只读等待或重试同步',async()=>{
 fixture=await implementationRefreshDatabase();const app=express();app.use(express.json());
 app.use('/ci',createImplementationCiRouter({pool:fixture.db,refreshOptions:fixture.options({error:new Error('源读取失败')})}));
 const response=await request(app).post('/ci/refresh').send(fixture.query);
 expect(response.status).toBe(500);expect(fixture.stats().readTransactions).toBe(0);
 expect((await fixture.db.query('SELECT contract_sync_revision FROM workflows')).rows.map(r=>r.contract_sync_revision)).toEqual(['1','1']);
});
it('正式repo登记只接受明确canonical来源，重传幂等、并发异scope同repo一个赢家，拒路径配置',async()=>{
  expect(createImplementationCiRouter).toBeTypeOf('function');fixture=await implementationImpactDatabase();
  const app=express();app.use(express.json());app.use('/ci',createImplementationCiRouter({pool:fixture.db}));
  const input={scope_key:'reviewed',repo:'reviewed-source',adapter_key:'legacy-ledger-v1',adapter_config:{source_repo:'owner/reviewed'}};
  let response=await request(app).post('/ci/repositories').send(input);expect(response.status,response.body).toBe(201);
  response=await request(app).post('/ci/repositories').send(input);expect(response.status,response.body).toBe(200);
  expect((await fixture.db.query('SELECT count(*)::int n FROM map_scope_repositories WHERE repo=$1',[input.repo])).rows[0].n).toBe(1);
  expect((await request(app).post('/ci/repositories').send({...input,scope_key:'other'})).status).toBe(409);
  expect((await request(app).post('/ci/repositories').send({...input,adapter_config:{source_repo:'owner/reviewed',path:'/tmp/execute'}})).status).toBe(400);
});

it('真实HTTP写入口60次每分钟限流，超额拒绝但只读snapshot仍可使用',async()=>{
 fixture=await implementationImpactDatabase();const app=express();app.use(express.json());app.use('/ci',createImplementationCiRouter({pool:fixture.db}));
 for(let i=0;i<60;i++)expect((await request(app).post('/ci/repositories').send({})).status).toBe(400);
 expect((await request(app).post('/ci/refresh').send({})).status).toBe(429);
 expect((await request(app).get('/ci/snapshot').query({scope:'phones',repo:IMPACT_REPO,revision:'a'.repeat(40)})).status).toBe(200);
});
