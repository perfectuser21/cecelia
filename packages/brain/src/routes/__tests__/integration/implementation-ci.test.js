import { afterEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { implementationImpactDatabase,IMPACT_REPO } from '../../../__tests__/fixtures/implementation-impact-db.js';
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
