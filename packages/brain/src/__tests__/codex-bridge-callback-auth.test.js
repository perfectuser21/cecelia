/**
 * codex-bridge callbackBrain 回调 Brain 必须带内部鉴权头（回归测试）
 *
 * 背景：PR #5592 给 POST /api/brain/execution-callback 挂了 internalAuthOrLoopback，
 * 生产容器配置 CECELIA_INTERNAL_TOKEN 后缺 Authorization: Bearer 一律 401。
 * xian-m4 / xian-m1 的 codex-bridge LaunchAgent 回调只带 Content-Type → 上产后回调全 401。
 * 任务 446aa294 / 决策 6ac4563e。
 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../../scripts/codex-bridge/codex-bridge.cjs');

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'test-internal-token-abc123';

function callbackFetchCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/brain/execution-callback'));
}

describe('codex-bridge callbackBrain 内部鉴权头', () => {
  let fetchMock;
  const savedEnv = {};

  beforeEach(() => {
    for (const key of ['CECELIA_INTERNAL_TOKEN', 'CECELIA_INTERNAL_ENV_FILE']) {
      savedEnv[key] = process.env[key];
    }
    // 隔离宿主机 ~/.credentials/cecelia-internal.env，避免测试结果随机器变
    process.env.CECELIA_INTERNAL_ENV_FILE = '/nonexistent/cecelia-internal.env';
    fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('callbackBrain 必须导出，供回归测试与桥机器自检使用', () => {
    expect(typeof bridge.callbackBrain).toBe('function');
  });

  it('配置 CECELIA_INTERNAL_TOKEN 时，回调 execution-callback 带 Authorization: Bearer <token>', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = TOKEN;

    await bridge.callbackBrain(TASK_ID, null, 'completed', 'ok', 123, RUN_ID);

    const calls = callbackFetchCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body).run_id).toBe(RUN_ID);
  });

  it('未配置 token 时不带 Authorization（非 production 本机回环仍可放行）', async () => {
    delete process.env.CECELIA_INTERNAL_TOKEN;

    await bridge.callbackBrain(TASK_ID, null, 'failed', 'boom', 5, RUN_ID);

    const [, init] = callbackFetchCalls(fetchMock)[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBeUndefined();
  });
});
