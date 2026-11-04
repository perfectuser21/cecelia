import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [{ cnt: 0, passed: 0, failed: 0 }] }) } }));
vi.mock('../tick.js', () => ({ getTickStatus: () => ({ enabled: false, loop_running: false }) }));
vi.mock('../runtime-safety.js', async () => ({ ...(await vi.importActual('../runtime-safety.js')), isIsolatedRuntime: () => true }));
import router from '../routes/goals.js';
const app = express(); app.use(router);
afterEach(() => vi.unstubAllEnvs());
describe('真实health路由通知配置状态', () => {
  it.each([
    [{ FEISHU_BOT_WEBHOOK: 'https://example.invalid/hook' }, 'configured', 'webhook'],
    [{ FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret', FEISHU_OWNER_OPEN_IDS: 'owner' }, 'configured', 'open_api'],
    [{}, 'unconfigured', 'none'],
    [{ FEISHU_APP_ID: 'app' }, 'unconfigured', 'open_api'],
  ])('配置%j对应%s/%s', async (env, status, channel) => {
    for (const key of ['FEISHU_BOT_WEBHOOK', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_OWNER_OPEN_IDS']) vi.stubEnv(key, env[key] || '');
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.organs.notifier).toEqual({ status, channel });
  });
});
