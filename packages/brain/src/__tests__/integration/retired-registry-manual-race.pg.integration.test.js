/** 两连接、私有 scratch：手动派发在账本预检期间不能覆盖别人的认领或误拿/释放设备锁。 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {privatePgConfig, verifyPrivatePg} from '../../../../../scripts/ci/private-pg-contract.mjs';

const io=vi.hoisted(()=>({query:vi.fn(),trigger:vi.fn()}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>io.query(...args)}}));
vi.mock('../../executor.js',async original=>({...await original(),triggerCeceliaRun:io.trigger,checkCeceliaRunAvailable:async()=>({available:true})}));
vi.mock('../../anchor-check.js',()=>({checkAnchor:()=>({blocked:false})}));
vi.mock('../../lib/resource-health-gate.js',()=>({resourceHealthGate:async()=>({blocked:false})}));

const id='00000000-0000-4000-8000-000000000321';
let owner, rival, app, schema, entered, release, response;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

describe('动态技能手动派发与并发数据库变更',()=>{
  beforeAll(async()=>{
    owner=new pg.Client(privatePgConfig()); rival=new pg.Client(privatePgConfig());
    await owner.connect(); await rival.connect();
    await verifyPrivatePg(owner); await verifyPrivatePg(rival);
    schema=`retired_registry_${randomUUID().replaceAll('-','')}`;
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`SET search_path TO "${schema}"`);
    await rival.query(`SET search_path TO "${schema}"`);
    await owner.query(`CREATE TABLE tasks (id uuid PRIMARY KEY,title text,status text,task_type text,
      payload jsonb,metadata jsonb,claimed_by text,claimed_at timestamptz,started_at timestamptz,updated_at timestamptz)`);
    await owner.query(`CREATE TABLE device_locks (device_name text PRIMARY KEY,locked_by text,locked_at timestamptz,expires_at timestamptz)`);
    await owner.query(`CREATE TABLE task_leases (task_id uuid,released_at timestamptz,lease_until timestamptz)`);
    await owner.query(`CREATE TABLE skill_registry (name text,status text,task_types text[],dispatch_command text)`);
    io.query.mockImplementation((sql,args)=>owner.query(sql,args));
    app=express();app.use(express.json());
    app.use('/api/brain',(await import('../../routes/tasks.js')).default);
    app.use('/api/brain',(await import('../../routes/execution.js')).default);
  });
  beforeEach(async()=>{
    vi.clearAllMocks();
    (await import('../../lib/skill-binding-registry.js'))._resetSkillBindingCacheForTest();
    await owner.query('TRUNCATE tasks,device_locks,task_leases,skill_registry');
    await owner.query(`INSERT INTO tasks(id,title,status,task_type,payload) VALUES ($1,'scan','queued','architecture_scan','{"device_serial":"device-a"}')`,[id]);
    await owner.query("INSERT INTO device_locks(device_name) VALUES ('device-a')");
    await owner.query("INSERT INTO skill_registry VALUES ('architect','active',ARRAY['architecture_scan'],'/architect scan')");
    entered=deferred();release=deferred();
    io.query.mockImplementation(async (sql,args)=>{
      if (String(sql).includes('FROM skill_registry')) {
        const result=await owner.query(sql,args); entered.resolve(); await release.promise; return result;
      }
      return owner.query(sql,args);
    });
    io.trigger.mockResolvedValue({success:true,runId:'should-not-start'});
  });
  afterAll(async()=>{
    release?.resolve();
    if (owner && schema) await owner.query(`DROP SCHEMA "${schema}" CASCADE`);
    await rival?.end();await owner?.end();
  });
  for(const endpoint of ['task','dispatch-now']){
    it(`${endpoint} 动态旧拆解绑定在取锁和启动前拒绝`,async()=>{
      await owner.query("UPDATE skill_registry SET name='decomp',status='deprecated',dispatch_command=NULL");
      release.resolve();
      const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
        : request(app).post('/api/brain/dispatch-now').send({task_id:id});
      const r=await route;
      expect(r.status).toBe(410);
      expect(io.trigger).not.toHaveBeenCalled();
      expect((await rival.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[id])).rows[0]).toEqual({status:'queued',claimed_by:null});
      expect((await rival.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0].locked_by).toBeNull();
    },10000);
    it(`${endpoint} 预检期间标题改变不能派发旧快照`,async()=>{
      const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
        : request(app).post('/api/brain/dispatch-now').send({task_id:id});
      response=route.then(x=>x);
      await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
      await rival.query("UPDATE tasks SET title='new title' WHERE id=$1",[id]);
      release.resolve();
      const r=await response;
      expect(r.status).toBe(409);
      expect(io.trigger).not.toHaveBeenCalled();
      expect((await rival.query('SELECT status,claimed_by,title FROM tasks WHERE id=$1',[id])).rows[0])
        .toEqual({status:'queued',claimed_by:null,title:'new title'});
    },10000);
    it(`${endpoint} 预检期间其他执行体认领，拒绝且不碰任务或设备锁`,async()=>{
      const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
        : request(app).post('/api/brain/dispatch-now').send({task_id:id});
      response=route.then(x=>x);
      await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
      await rival.query("UPDATE tasks SET status='in_progress',claimed_by='other',claimed_at=clock_timestamp() WHERE id=$1",[id]);
      release.resolve();
      const r=await response;
      expect(r.status).toBe(409);
      const row=(await owner.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[id])).rows[0];
      expect(row).toEqual({status:'in_progress',claimed_by:'other'});
      expect((await owner.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0].locked_by).toBeNull();
      expect(io.trigger).not.toHaveBeenCalled();
    },10000);
  }
  for (const status of ['in_progress','failed','blocked']) {
    it(`dispatch-now 对已是 ${status} 的审查任务拒绝重复派发`,async()=>{
      await owner.query('UPDATE tasks SET status=$2 WHERE id=$1',[id,status]);
      response=request(app).post('/api/brain/dispatch-now').send({task_id:id}).then(x=>x);
      await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
      release.resolve();
      const r=await response;
      expect(r.status).toBe(409);
      expect((await rival.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe(status);
      expect(io.trigger).not.toHaveBeenCalled();
    },10000);
  }
  for (const endpoint of ['task','dispatch-now']) {
    for (const reason of ['codex_review_pool_full','codex_binary_missing']) {
      for (const mode of ['owned','owner_changed','lock_reacquired']) {
        it(`${endpoint} ${reason} 未启动时 ${mode} 只清理本人占用`,async()=>{
          io.trigger.mockImplementation(async()=>{
            if(mode==='owner_changed') await rival.query("UPDATE tasks SET claimed_by='other',claimed_at=clock_timestamp() WHERE id=$1",[id]);
            if(mode==='lock_reacquired') await rival.query("UPDATE device_locks SET locked_at=clock_timestamp() WHERE device_name='device-a'");
            return {success:false,reason};
          });
          const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
            : request(app).post('/api/brain/dispatch-now').send({task_id:id});
          response=route.then(x=>x);
          await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
          release.resolve();
          const r=await response;
          expect(r.status).toBe(503);
          const row=(await rival.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[id])).rows[0];
          const held=(await rival.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0];
          if(mode==='owned') {
            expect(row).toEqual({status:'queued',claimed_by:null});expect(held.locked_by).toBeNull();
          } else {
            expect(row.status).toBe('in_progress');expect(held.locked_by).toBe(id);
            if(mode==='owner_changed') expect(row.claimed_by).toBe('other');
            else expect(row.claimed_by).toMatch(/^manual-review:/);
            expect(r.body.error).toBe('dispatch_state_unknown');
          }
        },10000);
      }
    }
  }
  for (const endpoint of ['task','dispatch-now']) {
    for (const mode of ['payload_changed','title_changed','owner_changed','lock_reacquired','database_error']) {
      it(`${endpoint} 抢到设备锁后 ${mode} 不覆盖新事实`,async()=>{
        const started=deferred(), proceed=deferred();
        const prior=io.query.getMockImplementation();
        let failCleanup=false;
        io.query.mockImplementation(async(sql,args)=>{
          const text=String(sql);
          if (text.includes("UPDATE tasks SET status='in_progress'")) {
            started.resolve(); await proceed.promise;
            if (mode==='database_error') { failCleanup=true; throw Error('受控数据库故障'); }
          }
          if (failCleanup && text.includes('WITH owned AS MATERIALIZED')) throw Error('受控数据库故障');
          return prior(sql,args);
        });
        const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
          : request(app).post('/api/brain/dispatch-now').send({task_id:id});
        response=route.then(x=>x);
        await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
        release.resolve();
        await Promise.race([started.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('状态 CAS 未开始')),3000))]);
        const held=(await rival.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0];
        expect(held.locked_by).toBe(id);
        if (mode==='payload_changed' || mode==='lock_reacquired') {
          await rival.query("UPDATE tasks SET payload=payload||'{\"revision\":1}'::jsonb WHERE id=$1",[id]);
        }
        if (mode==='title_changed') await rival.query("UPDATE tasks SET title='new title' WHERE id=$1",[id]);
        if (mode==='owner_changed') {
          await rival.query("UPDATE tasks SET status='in_progress',claimed_by='other',claimed_at=clock_timestamp() WHERE id=$1",[id]);
        }
        if (mode==='owner_changed' || mode==='lock_reacquired') {
          await rival.query("UPDATE device_locks SET locked_at=clock_timestamp() WHERE device_name='device-a'");
        }
        proceed.resolve();
        const r=await response;
        expect(r.status).toBe(mode==='payload_changed' || mode==='title_changed'?409:503);
        const row=(await rival.query('SELECT status,claimed_by,payload FROM tasks WHERE id=$1',[id])).rows[0];
        const heldAfter=(await rival.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0];
        if(mode==='payload_changed' || mode==='title_changed'){
          expect(row.status).toBe('queued');expect(row.claimed_by).toBeNull();
          if(mode==='payload_changed') expect(row.payload.revision).toBe(1);
          expect(heldAfter.locked_by).toBeNull();
        }else if(mode==='owner_changed'){
          expect(row.status).toBe('in_progress');expect(row.claimed_by).toBe('other');expect(heldAfter.locked_by).toBe(id);
        }else {
          expect(row.claimed_by).toMatch(/^manual-review:/);expect(heldAfter.locked_by).toBe(id);
        }
        expect(io.trigger).not.toHaveBeenCalled();
      },10000);
    }
  }

  for (const endpoint of ['task','dispatch-now']) {
    it(`${endpoint} 设备锁写入已提交但回执丢失时保留认领并报告未知`,async()=>{
      const prior=io.query.getMockImplementation();
      io.query.mockImplementation(async(sql,args)=>{
        if (String(sql).includes('UPDATE device_locks') && String(sql).includes('RETURNING')) {
          await owner.query(sql,args);
          throw Error('受控丢失设备锁回执');
        }
        return prior(sql,args);
      });
      const route=endpoint==='task' ? request(app).post(`/api/brain/tasks/${id}/dispatch`).send({})
        : request(app).post('/api/brain/dispatch-now').send({task_id:id});
      response=route.then(x=>x);
      await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('预检未开始')),3000))]);
      release.resolve();
      const r=await response;
      expect(r.status).toBe(503);expect(r.body.error).toBe('dispatch_state_unknown');
      const row=(await rival.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[id])).rows[0];
      expect(row.status).toBe('queued');expect(row.claimed_by).toMatch(/^manual-review:/);
      expect((await rival.query("SELECT locked_by FROM device_locks WHERE device_name='device-a'")).rows[0].locked_by).toBe(id);
      expect(io.trigger).not.toHaveBeenCalled();
    },10000);
  }

});
