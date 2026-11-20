import {beforeEach,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('../../db.js',async()=>({default:(await import('./helpers/task-mutation-pool.js')).taskMutationFixturePool((...args)=>query(...args))}));
let app;
beforeEach(async()=>{query.mockReset();app=express();app.use(express.json());const {default:router}=await import('../task-tasks.js');app.use('/tasks',router);});
it('普通DELETE不能取消DBOS仍在运行的foundation任务',async()=>{
 query.mockResolvedValueOnce({rows:[{status:'in_progress',payload:{commander_protocol:'commander-foundation-v1'},result:{foundation_runner:{run_id:'original'}}}]}).mockResolvedValueOnce({rows:[{status:'cancelled'}]});
 const response=await request(app).delete('/tasks/11111111-1111-4111-8111-111111111111');
 expect(response.status).toBe(409);expect(query).toHaveBeenCalledTimes(1);
 expect(response.body.code).toBe('FOUNDATION_CONTROL_OWNED');
});
it('普通任务仍可删除且UPDATE原子排除foundation身份',async()=>{
 query.mockResolvedValueOnce({rows:[{status:'queued',payload:{},result:{}}]}).mockResolvedValueOnce({rows:[{status:'cancelled'}]});
 const response=await request(app).delete('/tasks/11111111-1111-4111-8111-111111111111');
 expect(response.status).toBe(200);expect(query.mock.calls[1][0]).toContain("IS DISTINCT FROM 'commander-foundation-v1'");
});
it.each(['payload','metadata'])('通用POST的%s不能伪造底座协议或请求绑定',async field=>{
 for(const reserved of [{commander_protocol:'commander-foundation-v1'},{foundation_request:{machine_id:'forged'}},{foundation_request:null}]){
  query.mockReset();query.mockResolvedValue({rows:[{id:'bypassed',status:'queued'}]});
  const response=await request(app).post('/tasks').send({title:'冒用已冻结派单',task_type:'workflow_dispatch',[field]:reserved});
  expect(response.status).toBe(400);expect(response.body.code).toBe('FOUNDATION_CONTROL_RESERVED');expect(query).not.toHaveBeenCalled();
 }
});
it('普通POST仍走既有建单路径',async()=>{
 query.mockResolvedValue({rows:[{id:'ordinary',status:'queued'}]});
 const response=await request(app).post('/tasks').send({title:'普通任务',task_type:'research',payload:{topic:'example'}});
 expect(response.status).toBe(200);expect(response.body.id).toBe('ordinary');expect(query).toHaveBeenCalled();
});
