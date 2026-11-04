import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary=vi.hoisted(()=>({query:vi.fn(async()=>{throw Error('database forbidden');}),external:vi.fn(()=>{throw Error('external action forbidden');})}));
vi.mock('../db.js',()=>({default:{query:boundary.query}}));
vi.mock('../tick.js',()=>({getTickStatus:vi.fn(),enableTick:vi.fn(),disableTick:vi.fn(),executeTick:vi.fn(),runTickSafe:vi.fn(),drainTick:vi.fn(),getDrainStatus:vi.fn(),cancelDrain:vi.fn(),getStartupErrors:vi.fn(),check48hReport:vi.fn()}));
vi.mock('child_process',()=>({spawn:boundary.external,exec:boundary.external,execSync:boundary.external,execFile:boundary.external,execFileSync:boundary.external}));
vi.mock('node:child_process',()=>({spawn:boundary.external,exec:boundary.external,execSync:boundary.external,execFile:boundary.external,execFileSync:boundary.external}));
vi.mock('fs',async original=>{
 const fs=await original();const {resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');const root=resolve(process.cwd(),'../..');
 return {...fs,existsSync:()=>false,readdirSync:()=>[],readFileSync:(file,...args)=>{
  const target=file instanceof URL?fileURLToPath(file):resolve(String(file));
  if(!target.startsWith(root+'/')||target.includes('/.env')||/credential|auth\.json/.test(target))throw Error('host config forbidden');
  return fs.readFileSync(file,...args);
 }};
});
import router from '../routes/tick.js';
import * as executor from '../executor.js';
const app=express().use(express.json()).use('/api/brain',router);
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',boundary.external);executor.clearBillingPause();});
afterEach(()=>{executor.clearBillingPause();vi.unstubAllGlobals();});

describe('已无producer的旧session统计明确退休',()=>{
 it.each(['/session/stats','/session/stats?clear=true'])('%s真实HTTP410，零DB/模型/恢复分支',async path=>{
  const r=await request(app).get('/api/brain'+path);
  expect(r.status).toBe(410);
  expect(r.body).toEqual({success:false,error:'session_tracking_retired'});
  expect(r.body).not.toHaveProperty('current');expect(r.body).not.toHaveProperty('history');
  expect(boundary.query).not.toHaveBeenCalled();expect(boundary.external).not.toHaveBeenCalled();
 });
 it('不再导出无生产者的start/end/get/reset，不保留测试点火入口',()=>{
  for(const name of ['recordSessionStart','recordSessionEnd','getSessionInfo','_resetSessionStart'])expect(executor[name]).toBeUndefined();
 });
});

describe('活billingPause仍由真实函数和HTTP读取/清理',()=>{
 it('设置标志及唯一独立billing_pause_set事件，不需要session前置',async()=>{
  const query=vi.fn(async()=>({rows:[]}));const reset=new Date(Date.now()+60000).toISOString();
  executor.setBillingPause(reset,'quota_exhausted',{query});
  expect(executor.getBillingPause()).toMatchObject({active:true,resetTime:reset,reason:'quota_exhausted'});
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("VALUES ('billing_pause_set'");
  expect(JSON.parse(query.mock.calls[0][1][0])).toMatchObject({reset_at:reset,reason:'quota_exhausted'});
  const read=await request(app).get('/api/brain/billing-pause');
  expect(read.body).toMatchObject({success:true,active:true,resetTime:reset});
  const cleared=await request(app).get('/api/brain/billing-pause?clear=true');
  expect(cleared.body).toMatchObject({success:true,cleared:true,previous:{resetTime:reset}});
  expect((await request(app).get('/api/brain/billing-pause')).body).toEqual({success:true,active:false});
  expect(boundary.query).not.toHaveBeenCalled();expect(boundary.external).not.toHaveBeenCalled();
 });
 it('过期自动清除，无pool时零DB，无旧session恢复',()=>{
  executor.setBillingPause('2000-01-01T00:00:00Z','billing_cap');
  expect(executor.getBillingPause()).toEqual({active:false});
  expect(executor.clearBillingPause()).toEqual({cleared:false,previous:null});
  expect(boundary.query).not.toHaveBeenCalled();expect(boundary.external).not.toHaveBeenCalled();
 });
});
