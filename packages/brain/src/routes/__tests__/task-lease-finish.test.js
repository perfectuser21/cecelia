import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ finish: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { isolated: true } }));
vi.mock('../../lib/task-lease-finish.js', () => ({ finishTaskLease: mocks.finish }));
vi.mock('../../lib/task-lease.js', () => ({ heartbeatTaskLease: mocks.heartbeat, releaseTaskLease: vi.fn() }));
import router from '../task-lease.js';
const app = () => { const server = express(); server.use(express.json()); server.use('/tasks', router); return server; };
beforeEach(() => vi.clearAllMocks());
it('finish transports opaque claim epoch/result and returns authoritative service status', async () => {
  const receipt = { claimer: 'worker', claim_epoch: '2026-11-14 10:00:00.123456+00', status: 'completed', result_sha256: 'a'.repeat(64) };
  mocks.finish.mockResolvedValue({ status: 200, body: { ok: true, task_id: 'task', status: 'completed', replayed: false, receipt } });
  const res = await request(app()).post('/tasks/task/lease/finish').send({ claimer: 'worker', claim_epoch: receipt.claim_epoch, status: 'completed', result: { outputs: ['manifest.json'] } });
  expect(res.status).toBe(200); expect(res.body.receipt).toEqual(receipt);
  expect(mocks.finish).toHaveBeenCalledWith({ isolated: true }, { taskId: 'task', claimer: 'worker', claimEpoch: receipt.claim_epoch, status: 'completed', result: { outputs: ['manifest.json'] } });
});
it.each([400, 404, 409])('finish propagates rejected receipt status %s without reporting success', async status => {
  mocks.finish.mockResolvedValue({ status, body: { error: 'lease_lost' } });
  const res = await request(app()).post('/tasks/task/lease/finish').send({});
  expect(res.status).toBe(status); expect(res.body.error).toBe('lease_lost');
});
it('database failure returns unavailable without leaking exception details', async () => {
  mocks.finish.mockRejectedValue(Error('PRIVATE_DB_DETAIL'));
  const res = await request(app()).post('/tasks/task/lease/finish').send({});
  expect(res.status).toBe(503); expect(JSON.stringify(res.body)).not.toContain('PRIVATE_DB_DETAIL');
});
it('heartbeat forwards same epoch without converting microseconds', async () => {
  mocks.heartbeat.mockResolvedValue({ ok: true, lease: { lease_until: 'later', lease_seconds: 120, heartbeat_count: 2 } });
  const epoch = '2026-11-14 10:00:00.123456+00';
  const res = await request(app()).post('/tasks/task/heartbeat').send({ claimer: 'worker', claim_epoch: epoch, lease_seconds: 120 });
  expect(res.status).toBe(200);
  expect(mocks.heartbeat).toHaveBeenCalledWith({ isolated: true }, { taskId: 'task', claimer: 'worker', claimEpoch: epoch, leaseSeconds: 120 });
});
