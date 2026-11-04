import {afterEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import router from './routes.js';
import {getAllWorkers} from './config.js';
import * as workerConfig from './config.js';

const workerId=getAllWorkers()[0]?.id || 'missing-worker';
afterEach(()=>vi.unstubAllGlobals());
describe('员工工作流来源失败与成功空集分离',()=>{
 it('未登记能力的有效员工对成功来源返回空工作流',async()=>{
  const spy=vi.spyOn(workerConfig,'getWorkerById').mockReturnValueOnce({...getAllWorkers()[0],abilities:undefined});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:[]}),{status:200})));
  try {const app=express();app.use('/api/workers',router);const res=await request(app).get('/api/workers/'+workerId);expect(res.status).toBe(200);expect(res.body.success).toBe(true);expect(res.body.data.matchedWorkflows).toEqual([]);} finally {spy.mockRestore();}
 });
 it('未知员工保持404，不访问工作流来源',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const app=express();app.use('/api/workers',router);const res=await request(app).get('/api/workers/unknown-owned');expect(res.status).toBe(404);expect(fetch).not.toHaveBeenCalled();});
 it('现役目录从真实仓库配置装入员工',async()=>{const app=express();app.use('/api/workers',router);const res=await request(app).get('/api/workers');expect(res.status).toBe(200);expect(res.body.data.totalWorkers).toBeGreaterThan(0);});
 for(const suffix of ['', '/workflows']){
  it.each(['empty','http-error','network-error','invalid-body'])(`GET ${suffix||'detail'} 来源=%s`,async mode=>{
   const fetch=vi.fn(async()=>{
    if(mode==='network-error')throw Error('offline');
    return new Response(JSON.stringify(mode==='empty'?{data:[]}:{message:'unavailable'}),{status:mode==='http-error'?503:200});
   });
   vi.stubGlobal('fetch',fetch);
   const app=express();app.use('/api/workers',router);
   const res=await request(app).get(`/api/workers/${workerId}${suffix}`);
   expect(fetch).toHaveBeenCalledOnce();
   expect(res.status).toBe(mode==='empty'?200:503);
   expect(res.body.success).toBe(mode==='empty');
   if(mode!=='empty')expect(res.body.error).toBe('N8N 工作流来源不可用');
   else expect(suffix?res.body.data.workflows:res.body.data.matchedWorkflows).toEqual([]);
  });
 }
});
