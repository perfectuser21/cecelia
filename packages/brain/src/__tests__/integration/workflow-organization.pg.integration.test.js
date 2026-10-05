import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { likeSource } from '../fixtures/like-source.js';
const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => holder.db.query(...args) } }));
import routes from '../../routes/workflows.js';
let db, schema, ids, app;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离测试数据库');
  db = new pg.Client(DB_DEFAULTS); await db.connect(); holder.db = db;
  expect((await db.query('SELECT current_database() name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `workflow_org_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['areas', 'journeys', 'workflows', 'journey_steps', 'steps', 'spans', 'enablers', 'enabler_calls', 'schema_version']) {
    await db.query(`CREATE TABLE ${schema}.${table} (LIKE public.${likeSource(table)} INCLUDING ALL)`);
  }
  await db.query(`SET search_path TO ${schema}`);
  await db.query(readFileSync(new URL('../../../migrations/511_shared_activity_refs.sql', import.meta.url), 'utf8'));
  await db.query(readFileSync(new URL('../../../migrations/513_definition_versions.sql', import.meta.url), 'utf8'));
  ids = Object.fromEntries(['company', 'media', 'support', 'stream', 'capA', 'capB', 'wfA', 'wfB', 'activity'].map(k => [k, randomUUID()]));
  await db.query(`INSERT INTO areas(id,name,parent_area_id) VALUES($1,'公司',NULL),($2,'新媒体',$1),($3,'客服',$1)`, [ids.company, ids.media, ids.support]);
  await db.query(`INSERT INTO journeys(id,name,parent_journey_id,area_id,capability_code) VALUES
    ($1,'获客',NULL,$2,NULL),($3,'关键词',$1,NULL,'test_kw'),($4,'对标',$1,$5,'test_bm')`,
  [ids.stream, ids.media, ids.capA, ids.capB, ids.support]);
  await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel,form) VALUES
    ($1,$3,'test_keyword','关键词','douyin','android_rpa'),($2,$4,'test_benchmark','对标','douyin','android_rpa')`, [ids.wfA, ids.wfB, ids.capA, ids.capB]);
  await db.query(`INSERT INTO journey_steps(id,journey_id,name,step_number,workflow_id) VALUES($1,$2,'共享预检',1,$3)`, [ids.activity, ids.capA, ids.wfA]);
  await db.query(`INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no) VALUES($1,'preflight',$3,1),($2,'preflight',$3,1)`, [ids.wfA, ids.wfB, ids.activity]);
  app = express(); app.use('/api/brain', routes);
});
afterEach(async () => {
  if (db) { await db.query('ROLLBACK'); await db.query('SET search_path TO public'); if (schema) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
});
it('真实HTTP工作流同时返回规范能力身份、部门继承及平台形态，共享活动不改变消费者组织', async () => {
  const response = await request(app).get('/api/brain/workflows');
  expect(response.status, response.body.error).toBe(200);
  const kw = response.body.workflows.find(w => w.id === ids.wfA);
  const bm = response.body.workflows.find(w => w.id === ids.wfB);
  expect(kw.capability_code).toBe('test_kw');
  expect(kw.definition_status).toBe('unknown');
  expect(kw.activities[0].definition_status).toBe('unknown');
  expect(kw.organization).toMatchObject({ capability_id: ids.capA, value_stream_id: ids.stream, source: 'inherited', direct_area: null, effective_area: { id: ids.media } });
  expect(kw.organization.area_path.map(a => a.id)).toEqual([ids.company, ids.media]);
  expect(bm.organization).toMatchObject({ capability_id: ids.capB, source: 'direct', direct_area: { id: ids.support }, effective_area: { id: ids.support } });
  expect(kw.activities[0].activity_id).toBe(bm.activities[0].activity_id);
  expect(kw.activities[0].usage).toHaveProperty('activity_definition_version_id', null);
  expect(bm.activities[0].legacy_workflow_id).toBe(ids.wfA);
  expect(bm.channel).toBe('douyin'); expect(bm.form).toBe('android_rpa');
  const activity = await request(app).get(`/api/brain/activities/${ids.activity}`);
  expect(activity.status, activity.body.error).toBe(200);
  expect(activity.body.activity).toMatchObject({ canonical_id: ids.activity, definition_status: 'unknown', definition_version: null });
  expect((await request(app).get(`/api/brain/activities/${randomUUID()}`)).status).toBe(404);
  expect((await request(app).get('/api/brain/activities/bad')).status).toBe(400);
});
it('缺失部门归属明确unknown，部门祖先环查询有界并报告缺口', async () => {
  await db.query('UPDATE journeys SET area_id=NULL WHERE id=$1', [ids.stream]);
  const unknown = await request(app).get(`/api/brain/workflows/${ids.wfA}`);
  expect(unknown.status, unknown.body.error).toBe(200);
  expect(unknown.body.workflow.organization).toMatchObject({ source: 'unknown', effective_area: null });
  expect(unknown.body.workflow.organization.gaps.length).toBeGreaterThan(0);
  await db.query('UPDATE areas SET parent_area_id=$1 WHERE id=$2', [ids.support, ids.company]);
  const cycle = await request(app).get(`/api/brain/workflows/${ids.wfB}`);
  expect(cycle.status, cycle.body.error).toBe(200);
  expect(cycle.body.workflow.organization.gaps.length).toBeGreaterThan(0);
  expect(cycle.body.workflow.organization.area_path.length).toBeLessThanOrEqual(3);
});
