import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const io=vi.hoisted(()=>({query:vi.fn(async()=>({rows:[]}))}));
vi.mock('../../db.js',()=>({default:{query:io.query}}));

describe('dispatch-now 限流',()=>{
  it('前 300 个有效请求查库，第 301 个返回 429 且不再查库',async()=>{
    const app=express();app.use(express.json());
    app.use('/api/brain',(await import('../execution.js')).default);
    for(let i=0;i<300;i++) {
      const response=await request(app).post('/api/brain/dispatch-now').send({task_id:'missing'});
      expect(response.status).toBe(404);
    }
    expect(io.query).toHaveBeenCalledTimes(300);
    const response=await request(app).post('/api/brain/dispatch-now').send({task_id:'missing'});
    expect(response.status).toBe(429);
    expect(io.query).toHaveBeenCalledTimes(300);
  },20000);
});
