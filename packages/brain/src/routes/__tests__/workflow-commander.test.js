import { afterEach, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowCommanderRouter } from '../workflow-commander.js';
const previous=process.env.CECELIA_INTERNAL_TOKEN;
afterEach(()=>{if(previous===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=previous;});
it('内部反馈无凭据零数据库访问；已鉴权仍检查事件大小和类型',async()=>{
 process.env.CECELIA_INTERNAL_TOKEN='fixture-only';
 const pool={connect:vi.fn()}, app=express();app.use('/api/brain/workflow-commander',createWorkflowCommanderRouter(pool));
 const endpoint='/api/brain/workflow-commander/tasks/aaaaaaaa-1111-2222-3333-444444444444/events';
 expect((await request(app).post(endpoint).send({})).status).toBe(401);
 expect((await request(app).post(endpoint).set('Authorization','Bearer fixture-only').send({protocol:'commander-v2',type:'evil',seq:1,data:{}})).status).toBe(422);
 expect((await request(app).post(endpoint).set('Authorization','Bearer fixture-only').send({data:{x:'x'.repeat(220000)}})).status).toBe(413);
 expect(pool.connect).not.toHaveBeenCalled();
});
it('失败对账入口必须鉴权且不接状态覆盖或任意证据路径',async()=>{
 process.env.CECELIA_INTERNAL_TOKEN='fixture-only';
 const pool={connect:vi.fn(),query:vi.fn()},app=express();app.use('/api/brain/workflow-commander',createWorkflowCommanderRouter(pool));
 const endpoint='/api/brain/workflow-commander/tasks/aaaaaaaa-1111-2222-3333-444444444444/reconcile-failed';
 expect((await request(app).post(endpoint).send({execution_stopped:true})).status).toBe(401);
 expect((await request(app).post(endpoint).set('Authorization','Bearer fixture-only').send({execution_stopped:true,cleanup_path:'/tmp/caller.json'})).status).toBe(409);
 expect((await request(app).post(endpoint).set('Authorization','Bearer fixture-only').send({x:'a'.repeat(5000)})).status).toBe(413);
 expect(pool.query).not.toHaveBeenCalled();expect(pool.connect).not.toHaveBeenCalled();
});
