import { readFileSync } from 'node:fs';
import { afterEach,beforeEach,it,expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createRelease,recordReleaseObservation } from '../../../lib/release-index.js';
import { bindRunDefinition } from '../../../lib/run-definition-binding.js';
import { createRunReconciliationRouter } from '../../run-reconciliation.js';
let f,app;
beforeEach(async()=>{
  f=await releaseEvidenceDatabase();await f.db.query('DROP TABLE spans CASCADE');
  for(const file of ['495_vs_model_spans.sql','513_span_occurrences.sql','515_span_definition_provenance.sql'])await f.db.query(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8'));
  app=express();app.use('/runs',createRunReconciliationRouter({pool:f.db}));
});
afterEach(async()=>{await f?.close();f=null;});
it('未知外部运行只给unknown且不会生成新的任务或运行',async()=>{
  const r=await request(app).get('/runs/external__a1/reconciliation');expect(r.status).toBe(200);
  expect(r.body).toMatchObject({business_outcome:'unknown',evidence_status:'unknown',links:{task_run_id:null,task_id:null,initiative_run_id:null,harness_attempt_ids:[]}});
  expect((await f.db.query('SELECT * FROM task_runs')).rows).toHaveLength(0);
});
it('已有冻结定义而无实际Span，HTTP明确列出缺失步骤',async()=>{
  const release=(await createRelease(f.db,f.releaseInput)).release;
  const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
  const input=f.runInput(release,observation);const {binding}=await bindRunDefinition(f.db,'external__a1',input);
  const r=await request(app).get('/runs/external__a1/reconciliation');expect(r.status,r.body).toBe(200);
  expect(r.body).toMatchObject({run_binding_id:binding.id,business_outcome:'unknown',evidence_status:'incomplete',expected_count:input.expected_path.length});
  expect(r.body.missing).toHaveLength(input.expected_path.length);
});
