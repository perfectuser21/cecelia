import { afterEach,beforeEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createRelease,recordReleaseObservation } from '../../../lib/release-index.js';
import { createRunDefinitionsRouter } from '../../run-definitions.js';
let f,app,release,observation;
beforeEach(async()=>{f=await releaseEvidenceDatabase();release=(await createRelease(f.db,f.releaseInput)).release;observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;app=express();app.use(express.json());app.use('/runs',createRunDefinitionsRouter({pool:f.db}));});
afterEach(async()=>{await f?.close();});
it('HTTP运行定义精确回读，未知历史返回404且无推断latest',async()=>{
  const first=await request(app).post('/runs/external-http/definition').send(f.runInput(release,observation));expect(first.status).toBe(201);
  const result=await request(app).get('/runs/external-http/definition');expect(result.status).toBe(200);expect(result.body.binding).toEqual(first.body.binding);expect(result.body.workflow.id).toBe(first.body.binding.workflow_definition_version_id);
  expect(result.body.definition_view).toBe('compact');expect(result.body.release.payload).toBeUndefined();expect(Buffer.byteLength(result.text)).toBeLessThan(64*1024);
  const full=await request(app).get('/runs/external-http/definition?view=full');expect(full.status).toBe(200);expect(full.body.binding).toEqual(first.body.binding);expect(full.body.release.payload.workflows.length).toBeGreaterThan(0);
  expect((await request(app).get('/runs/old-unknown/definition')).status).toBe(404);
});
