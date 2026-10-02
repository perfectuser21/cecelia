import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createCapabilitySystemRouter } from '../../capability-system.js';
import { createRelease,recordReleaseObservation } from '../../../lib/release-index.js';
import { bindRunDefinition } from '../../../lib/run-definition-binding.js';
let f,app;
beforeEach(async()=>{
  f=await releaseEvidenceDatabase();await f.db.query('CREATE TABLE journey_features (LIKE public.journey_features INCLUDING ALL)');
  app=express();app.use('/map',createCapabilitySystemRouter({pool:f.db}));
});
afterEach(async()=>{vi.unstubAllEnvs();await f?.close();});
it('展示面无需内部写token，固定元数据可读但不提供写入口',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','not-for-browser');
  const result=await request(app).get('/map/registry');expect(result.status).toBe(200);expect(result.body.counts.activities.total).toBe(9);
  expect((await request(app).post('/map/releases').send(f.releaseInput)).status).toBe(404);
});
it('运行无span保持incomplete，发布CI只返回白名单而不返回测试命令',async()=>{
  const release=(await createRelease(f.db,f.releaseInput)).release;
  const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
  await bindRunDefinition(f.db,'safe-read',f.runInput(release,observation));
  const result=await request(app).get('/map/runs/safe-read/evidence');
  expect(result.status).toBe(200);expect(result.body).toMatchObject({business_outcome:'unknown',evidence_status:'incomplete',span_count:0});
  expect(result.body.missing.length).toBeGreaterThan(0);expect(result.body).not.toHaveProperty('task_run');expect(result.body).not.toHaveProperty('context');
  const evidence=(await request(app).get(`/map/releases/${release.id}/evidence`)).body;
  expect(evidence.release.gate.deployed).toBe(true);expect(evidence.ci_evidence[0].verdict).toBe('PASS');
  expect(evidence.ci_evidence[0]).not.toHaveProperty('report');expect(evidence.ci_evidence[0].assertions[0]).not.toHaveProperty('command');
});
it('拒绝非法分页、重复参数、UUID和无界changed_files',async()=>{
  for(const path of ['/runs?limit=-1','/runs?limit=101','/runs?offset=1.2','/runs?workflow_id=bogus','/runs?limit=1&limit=2','/releases/bogus/evidence','/implementation-impact?changed_files=not-json']){
    expect((await request(app).get(`/map${path}`)).status,path).toBe(400);
  }
});
it('全量registry不能通过嵌套Workflow契约或Step readback透出任意context和命令',async()=>{
  await f.db.query(`UPDATE journey_steps SET contract=contract || '{"context":{"private_note":"PRIVATE_MARKER"},"execution_command":"PRIVATE_COMMAND","logs":["PRIVATE_LOG"]}'::jsonb`);
  await f.db.query(`UPDATE steps SET readback='{"context":"PRIVATE_READBACK"}'::jsonb`);
  const response=await request(app).get('/map/registry');expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_(MARKER|COMMAND|LOG|READBACK)/);
  expect(response.body.workflows[0].activities[0].usage.reference_id).toBeTruthy();
});
it('浏览器影响报告保留受影响引用与断言身份，不公开回归执行命令',async()=>{
  const source=f.releaseInput.ci_evidence[0].report.source;
  const result=await request(app).get('/map/implementation-impact').query({scope:'phones',repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:JSON.stringify(source.changed_files)});
  expect(result.status).toBe(200);expect(result.body.affected_usages.length).toBeGreaterThan(0);
  expect(result.body.required_assertions.length).toBeGreaterThan(0);
  expect(JSON.stringify(result.body)).not.toContain('"command":');
});
