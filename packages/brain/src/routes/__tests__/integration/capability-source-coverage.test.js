import { afterEach, beforeEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { coverageDatabase } from '../../../__tests__/fixtures/capability-coverage-db.js';
import { createCapabilitySystemRouter } from '../../capability-system.js';
let f, app;
beforeEach(async () => { f = await coverageDatabase(); app = express(); app.use('/map', createCapabilitySystemRouter({ pool: f.db })); });
afterEach(async () => { await f?.close(); });

it('正式只读HTTP六来源全部可分页核对，不透台账config/metadata/dispatch/内容', async () => {
  for (const kind of ['skills', 'repositories', 'apis', 'ops_workflows', 'resources', 'legacy_features']) {
    const response = await request(app).get('/map/coverage').query({ kind, limit: 100 });
    expect(response.status).toBe(200);
    expect(response.body.sources).toHaveLength(6);
    expect(response.body.items).toHaveLength(response.body.selection.total);
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_|"config":|"metadata":|"dispatch":|"content_md":|"command":/);
    for (const item of response.body.items) expect(Object.keys(item).sort()).toEqual(['id', 'name', 'kind', 'coverage_status', 'reason', 'record_status', 'source', 'consumers'].sort());
  }
  expect((await request(app).post('/map/coverage').send({})).status).toBe(404);
});

it('非法来源/筛选、重复query及无界分页均400，不退回默认全表', async () => {
  for (const query of ['kind=bogus', 'kind=skills&kind=apis', 'coverage=green', 'limit=101', 'limit=0', 'limit=1&limit=2', 'offset=-1', 'offset=1.2', 'offset=9007199254740993']) {
    expect((await request(app).get(`/map/coverage?${query}`)).status, query).toBe(400);
  }
});
