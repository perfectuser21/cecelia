import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
const shared=vi.hoisted(()=>({db:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>shared.db.pool.query(...args),connect:(...args)=>shared.db.pool.connect(...args)}}));
let app;
beforeAll(async()=>{shared.db=await createIntakeTestDatabase();const router=(await import('../../routes/task-tasks.js')).default;app=express().use(express.json()).use('/tasks',router);});
afterAll(async()=>{await shared.db?.close();});
const input=()=>({title:'gpu-http-'+randomUUID(),task_type:'workflow_run',mutation_intent:'read_only',domain:'operations'});
it('公共HTTP去重前拒绝GPU声明，不改已有CPU任务',async()=>{
 const base=input();const first=await request(app).post('/tasks').send(base);expect(first.status).toBe(201);
 const before=await shared.db.pool.query('SELECT to_jsonb(t) AS task FROM tasks t WHERE title=$1',[base.title]);
 const response=await request(app).post('/tasks').send({...base,payload:{gpu:true}});
 expect((await shared.db.pool.query('SELECT to_jsonb(t) AS task FROM tasks t WHERE title=$1',[base.title])).rows).toEqual(before.rows);
 expect(response.status).toBe(400);
});
it('公共HTTP同时检查payload与metadata，不静默丢弃GPU',async()=>{
 const base=input();
 const response=await request(app).post('/tasks').send({...base,payload:{},metadata:{gpu:true}});
 expect((await shared.db.pool.query('SELECT id FROM tasks WHERE title=$1',[base.title])).rowCount).toBe(0);
 expect(response.status).toBe(400);
});
