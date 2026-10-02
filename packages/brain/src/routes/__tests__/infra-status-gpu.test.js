import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {fleet}=vi.hoisted(()=>({fleet:vi.fn()}));
vi.mock('../../fleet-resource-cache.js',()=>({getFleetStatus:fleet}));
vi.mock('../../machine-registry.js',()=>({MACHINES:[{id:'m4',name:'M4',isLocal:true}],listComputeWorkerIds:()=>['m4']}));
vi.mock('child_process',()=>({exec:vi.fn(),execSync:vi.fn(()=>{throw new Error('no host probes');})}));
import router from '../infra-status.js';
const app=express().use(router);
describe('机器监控 GPU 投影',()=>{
 it('直接使用 Worker 缓存，不把真实零利用率变成未知',async()=>{
  const gpu={status:'present',source:'macos-ioreg',observed_at:new Date().toISOString(),devices:[{name:'Apple M4',utilization_percent:0,memory_kind:'unified',memory_used_bytes:128}]};
  fleet.mockReturnValue([{id:'m4',gpu}]);
  const response=await request(app).get('/servers');
  expect(response.status).toBe(200);expect(response.body.servers[0].gpu).toEqual(gpu);
 });
 it('未被 Worker 采到的机器明确未知',async()=>{
  fleet.mockReturnValue([]);
  const response=await request(app).get('/servers');
  expect(response.body.servers[0].gpu).toEqual({status:'unknown',source:'unavailable',observed_at:null,devices:[]});
 });
});
