import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks=vi.hoisted(()=>({query:vi.fn(),configs:[],limiters:[]}));
vi.mock('../../db.js',()=>({default:{query:mocks.query}}));
vi.mock('../../projection/notion.js',()=>({bootstrapNotionDatabases:async()=>({created:true}),configureNotionProjection:async()=>({configured:true})}));
vi.mock('../../projection/key-results.js',()=>({configureKrProjection:async()=>({configured:true})}));
vi.mock('../../projection/task-runs-config.js',()=>({configureTaskRunsProjection:async()=>({configured:true})}));
vi.mock('express-rate-limit',async original=>{
 const real=await original();
 return {...real,rateLimit:options=>{
  mocks.configs.push(options);
  // A real limiter/store at a small test-only threshold; no production requests.
  const limiter=real.rateLimit({...options,limit:2});mocks.limiters.push(limiter);return limiter;
 }};
});

const routes=[
 ['post','/projections/notion/task-runs/configure'],
 ['post','/projections/notion/task-runs/bootstrap'],
 ['get','/projections/status'],
 ['post','/projections/requeue'],
 ['post','/projections/notion/key-results/configure'],
 ['post','/projections/notion/bootstrap'],
 ['post','/projections/notion/configure'],
 ['get','/workbench/activity'],
 ['get','/workbench/summary'],
];
const unrelated=['/tasks/11111111-1111-4111-8111-111111111111','/runs/fixture-run/definition','/device-locks/fixture-device','/projections/notion/directory/state'];
let app,router;
beforeEach(async()=>{
 vi.resetModules();mocks.configs.length=0;mocks.limiters.length=0;
 mocks.query.mockReset().mockResolvedValue({rows:[{}],rowCount:1});
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','projection-scope-test-only');
 router=(await import('../projections.js')).default;
 app=express();app.set('trust proxy',1);app.use(express.json());
 // Match the broad production mount, with downstream Brain routes still reachable.
 app.use('/api/brain',router);
 for(const path of unrelated)app.get('/api/brain'+path,(_req,res)=>res.json({downstream:true}));
 app.use((_req,res)=>res.sendStatus(204));
});
afterEach(()=>vi.unstubAllEnvs());
const call=(method,path,token='projection-scope-test-only',ip='198.51.100.10')=>request(app)[method]('/api/brain'+path).set('X-Internal-Token',token).set('X-Forwarded-For',ip);

it('full broad mount does not count downstream Task/run/lock/directory traffic or return projection429',async()=>{
 const responses=[];
 for(let i=0;i<3;i++)for(const path of unrelated)responses.push(await call('get',path));
 expect(responses.map(response=>response.status)).toEqual(Array(12).fill(200));
 for(const response of responses)expect(response.headers.ratelimit).toBeUndefined();
 expect(mocks.query).not.toHaveBeenCalled();
 expect((await call('get','/projections/status')).status).toBe(200);
 expect((await call('get','/workbench/activity')).status).toBe(200);
 expect((await call('get','/projections/status')).status).toBe(429);
});

it.each(routes)('the original %s %s shares one budget with every other projection endpoint',async(method,path)=>{
 expect((await call('get','/projections/status')).status).toBe(200);
 const second=await call(method,path);expect([200,201]).toContain(second.status);
 expect(second.headers.ratelimit).toMatch(/limit=2.*remaining=0/);
 expect((await call('get','/workbench/summary')).status).toBe(429);
});

it('one unchanged production limiter instance is the first middleware on all nine real registrations',()=>{
 expect(mocks.configs).toEqual([{windowMs:60000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}]);
 expect(mocks.limiters).toHaveLength(1);
 const registered=router.stack.filter(layer=>layer.route);
 expect(registered).toHaveLength(9);
 expect(registered.map(layer=>[Object.keys(layer.route.methods)[0],layer.route.path])).toEqual(routes);
 for(const layer of registered)expect(layer.route.stack[0].handle).toBe(mocks.limiters[0]);
});

it('bad tokens still consume the shared budget before auth, including both loop POST routes',async()=>{
 expect((await call('post',routes[0][1],'wrong')).status).toBe(401);
 expect((await call('post',routes[1][1],'wrong')).status).toBe(401);
 expect((await call('get','/projections/status')).status).toBe(429);
 expect((await call('get',unrelated[0])).status).toBe(200);
 expect(mocks.query).not.toHaveBeenCalled();
});

it('automatic GET HEAD uses the same shared store and keeps draft7 without legacy headers',async()=>{
 const head=await call('head','/projections/status');expect(head.status).toBe(200);
 expect(head.headers.ratelimit).toMatch(/limit=2.*remaining=1/);expect(head.headers['ratelimit-policy']).toMatch(/2;w=60/);
 expect(head.headers['x-ratelimit-limit']).toBeUndefined();
 expect((await call('get','/workbench/activity')).status).toBe(200);
 expect((await call('head','/workbench/summary')).status).toBe(429);
});

it('unregistered paths and methods do not become a wider prefix-based quota',async()=>{
 for(const [method,path]of [['get','/projections/status/extra'],['get','/projections/notion/unknown'],['post','/workbench/activity']]){
  const response=await call(method,path);expect(response.status).toBe(204);expect(response.headers.ratelimit).toBeUndefined();
 }
 expect((await call('get','/projections/status')).status).toBe(200);
 expect((await call('get','/projections/status')).status).toBe(200);
});

it('the original default IP key remains isolated without route-specific extra budgets',async()=>{
 for(let i=0;i<2;i++)expect((await call('get','/projections/status')).status).toBe(200);
 expect((await call('get','/workbench/summary')).status).toBe(429);
 expect((await call('get','/workbench/summary','projection-scope-test-only','198.51.100.11')).status).toBe(200);
});
