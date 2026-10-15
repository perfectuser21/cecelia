import { afterEach,describe,it,expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createInvocationsRouter } from './invocations.js';
const previous=process.env.CECELIA_INTERNAL_TOKEN;
afterEach(()=>{if(previous===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=previous;});
describe('调用HTTP边界',()=>{
 it('浏览器声明租户不能替代内部认证',async()=>{
  process.env.CECELIA_INTERNAL_TOKEN='test-private';let reads=0;
  const app=express();app.use(express.json());app.use('/api/brain/invocations',createInvocationsRouter({db:{query:async()=>{reads++;return {rows:[]};}}}));
  const res=await request(app).post('/api/brain/invocations/resolve').set('x-tenant-id','other').send({});expect(res.status).toBe(401);expect(reads).toBe(0);
 });
 it('认证后按租户读取原请求键，未知键404且不派发',async()=>{
  process.env.CECELIA_INTERNAL_TOKEN='test-private';const queries=[];
  const app=express();app.use(express.json());app.use('/api/brain/invocations',createInvocationsRouter({db:{query:async(sql,args)=>{queries.push(args);return {rows:[]};}}}));
  const res=await request(app).get('/api/brain/invocations/by-request/one').set('Authorization','Bearer test-private').set('x-tenant-id','tenant-a');
  expect(res.status).toBe(404);expect(queries).toEqual([['one','tenant-a']]);
 });
 it('输入不完整是可读错误',async()=>{
  process.env.CECELIA_INTERNAL_TOKEN='test-private';const app=express();app.use(express.json());app.use('/api/brain/invocations',createInvocationsRouter({db:{}}));
  const res=await request(app).post('/api/brain/invocations/resolve').set('Authorization','Bearer test-private').send({});expect(res.status).toBe(422);expect(res.body.message).toContain('target');
 });
});
