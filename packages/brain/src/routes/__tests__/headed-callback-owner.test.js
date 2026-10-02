import {it,expect,vi,beforeAll,beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
const pool=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock('../../db.js',()=>({default:pool}));
let router;
beforeAll(async()=>{router=(await import('../execution.js')).default;});
beforeEach(()=>{
 vi.clearAllMocks();
 pool.query.mockImplementation(async(sql)=>{
  if(sql.includes("payload->'headed_takeover'"))return {rows:[{headed_takeover:{generation:'actual-generation'}}]};
  throw Error('unexpected SQL before owner rejection');
 });
});
it.each(['old-run',undefined])('HTTP旧回调run=%s在queue/run/副作用之前拒绝',async run_id=>{
 const app=express();app.use(express.json());app.use(router);
 const saved=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='isolated-http-owner-test';
 try{
  const response=await request(app).post('/execution-callback').set('Authorization','Bearer isolated-http-owner-test').send({task_id:'723-qualification-fixture',run_id,status:'AI Done'});
  expect(response.body.error).toContain('headed_task_owned');
  expect(pool.query).toHaveBeenCalledTimes(1);expect(pool.connect).not.toHaveBeenCalled();
 }finally{if(saved===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=saved;}
});
