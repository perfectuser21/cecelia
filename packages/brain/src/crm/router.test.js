import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCrmRouter } from './router.js';
afterEach(() => vi.unstubAllEnvs());
function fixture() { const db = { query: vi.fn() }, app = express(); app.use(express.json()); app.use('/crm', createCrmRouter({ pool: db })); return { db, app }; }
describe('CRM internal HTTP boundary', () => {
  it('rejects unauthenticated reads and writes even on loopback', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret'); const { app, db } = fixture();
    expect((await request(app).get('/crm/status')).status).toBe(401);
    expect((await request(app).post('/crm/accounts').send({})).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('returns disabled status without touching missing production tables', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret'); vi.stubEnv('CRM_SYNC_ENABLED', 'false'); const { app, db } = fixture();
    expect((await request(app).get('/crm/status').set('Authorization', 'Bearer secret')).body.enabled).toBe(false);
    expect((await request(app).post('/crm/accounts').set('Authorization', 'Bearer secret').send({})).status).toBe(503);
    expect(db.query).not.toHaveBeenCalled();
  });
});
