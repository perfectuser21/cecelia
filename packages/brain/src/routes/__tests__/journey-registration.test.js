import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('../../lib/journey-registration.js', () => ({ registerJourney: mocks.register }));
import { journeyRegistrationRouter } from '../journey-registration.js';
let app;
beforeEach(() => { mocks.register.mockReset(); app = express(); app.use(express.json()); app.use(journeyRegistrationRouter({})); });
it.each([400, 404, 409])('登记服务的%s错误通过HTTP保留且不伪装成功', async status => {
  mocks.register.mockRejectedValue(Object.assign(new Error('登记拒绝'), { status }));
  const response = await request(app).post('/journeys').send({ name: '能力' });
  expect(response.status).toBe(status); expect(response.body.error).toBe('登记拒绝');
});
it('创建与修改保留不同HTTP语义，修改ID原样传给登记服务', async () => {
  const id = 'a1000000-0000-4000-8000-000000000001';
  mocks.register.mockResolvedValue({ id, name: '能力' });
  expect((await request(app).post('/journeys').send({ name: '能力' })).status).toBe(201);
  const changed = await request(app).patch(`/journeys/${id}`).send({ name: '改名' });
  expect(changed.status).toBe(200); expect(changed.body.id).toBe(id);
  expect(mocks.register.mock.calls[1].slice(1)).toEqual([{ name: '改名' }, id]);
});
