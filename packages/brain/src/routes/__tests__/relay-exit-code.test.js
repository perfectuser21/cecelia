import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ query: vi.fn(), capture: vi.fn(), bark: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../../notifier.js', () => ({ sendBark: boundary.bark }));
vi.mock('../../lib/relay-forensics.js', () => ({ captureRelayContainerLogs: boundary.capture }));
vi.mock('../../lib/harness-orphan-guard.js', () => ({ handleRelayExitConsistency: async () => ({ action: 'noop' }) }));

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  boundary.query.mockResolvedValue({ rows: [], rowCount: 1 });
  boundary.capture.mockResolvedValue({ ok: true });
  const { default: router, _resetCallbackDedupeForTests } = await import('../harness-callback.js');
  _resetCallbackDedupeForTests();
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});
afterEach(() => vi.restoreAllMocks());

// 原毕业副本GP4只有常量断言；现由真正HTTP回执保存watchdog要消费的退出码。
describe('relay退出码真实回调', () => {
  it.each([137, '137', 0, 1])('退出码%s经真实路由写入正确任务前缀', async exit_code => {
    const result = await request(app).post('/api/brain/harness/callback/cecelia-relay-aabbccdd-test')
      .send({ result: 'finished', exit_code });
    expect(result.status).toBe(200);
    const writes = boundary.query.mock.calls.filter(([sql]) => sql.includes('last_container_exit_code'));
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual(['aabbccdd%', Number(exit_code)]);
    expect(boundary.capture).toHaveBeenCalledWith({ containerId: 'cecelia-relay-aabbccdd-test' });
  });

  it.each([{}, { exit_code: 'unknown' }])('未提供或无效退出码不伪造OOM数据：%j', async body => {
    expect((await request(app).post('/api/brain/harness/callback/cecelia-relay-aabbccdd-test')
      .send({ result: 'finished', ...body })).status).toBe(200);
    expect(boundary.query.mock.calls.filter(([sql]) => sql.includes('last_container_exit_code'))).toHaveLength(0);
  });

  it('数据库故障保留best-effort回执，不因写失败要求容器重发', async () => {
    boundary.query.mockRejectedValue(new Error('database unavailable'));
    expect((await request(app).post('/api/brain/harness/callback/cecelia-relay-aabbccdd-test')
      .send({ result: 'finished', exit_code: 137 })).status).toBe(200);
    expect(boundary.query.mock.calls.filter(([sql]) => sql.includes('last_container_exit_code'))).toHaveLength(1);
  });
});
