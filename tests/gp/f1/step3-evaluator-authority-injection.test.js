/** 旧Kernel attempt-run已退役：输入候选坐标不能恢复旧派发。公共Runner验收由独立validator完成。 */
import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createHarnessAttemptRunRouter} from '../../../packages/brain/src/routes/harness-attempt-run.js';
describe('旧evaluator/judge/gen创建入口退役',()=>{
 it.each(['evaluator','judge','generator','generator-fix'])('role %s 无论候选坐标如何都不创建资源',async role=>{
  const effect=vi.fn();const pool={query:effect};const app=express();app.use(express.json());
  app.use('/api/brain/harness',createHarnessAttemptRunRouter({pool,buildDeps:effect,createTaskFn:effect,attemptStoreFactory:effect}));
  for(const candidate of [undefined,{repo:'perfectuser21/cecelia',branch:'cp-old',base_sha:'a'.repeat(40),head_sha:'b'.repeat(40)}]){
   const response=await request(app).post('/api/brain/harness/attempt-run').send({role,title:'old',run_id:'cccccccc-0000-0000-0000-000000000009',payload:{sprint_dir:'old',candidate}});
   expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');
  }
  expect(effect).not.toHaveBeenCalled();
 });
});
