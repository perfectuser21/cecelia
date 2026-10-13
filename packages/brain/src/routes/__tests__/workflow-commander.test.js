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
