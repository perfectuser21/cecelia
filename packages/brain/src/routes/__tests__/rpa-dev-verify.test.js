/**
 * RPA 开发快验通道 Brain 路由单测
 *
 * 覆盖：白名单拒绝、invalid_line、超时、Agent 不可达、成功路径
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

// ─── 被测模块 ─────────────────────────────────────────────────────────────────

import rpaDevVerifyRouter, { _injectFetch, _resetFetch } from '../rpa-dev-verify.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/rpa', rpaDevVerifyRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  _injectFetch(mockFetch);
  delete process.env.RPA_DEV_VERIFY_ENABLED;
  delete process.env.RPA_AGENT_URL;
});

afterEach(() => {
  _resetFetch();
});

// ─── 参数校验 ─────────────────────────────────────────────────────────────────

describe('POST /api/brain/rpa/dev-verify — 参数校验', () => {
  it('缺少 line → 400 invalid_line', async () => {
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ action: 'health_check', params: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_line');
  });

  it('无效 line → 400 invalid_line', async () => {
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'tiktok', action: 'health_check' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_line');
  });

  it('缺少 action → 400 action_required', async () => {
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', params: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('action_required');
  });

  it('action 不在白名单 → 400 action_not_allowed + allowed 列表', async () => {
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'shell' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('action_not_allowed');
    expect(res.body.allowed).toContain('health_check');
    expect(res.body.allowed).not.toContain('shell');
  });

  it('wechat 白名单与 Agent 已注册动作名对齐(E2E 接缝)', async () => {
    // Agent 侧(zenithjoy-workspace DEV_VERIFY_WHITELIST)是执行权威闸——
    // 旧的 send_message/screenshot 等通用名 Agent 必拒 not_whitelisted,E2E 打不通
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'definitely_not_allowed' });
    expect(res.status).toBe(400);
    expect(res.body.allowed).toEqual(
      expect.arrayContaining(['wechat_private_chat_send', 'wechat_moments_send', 'wechat_qr_bind']),
    );
    expect(res.body.allowed).not.toContain('send_message');
  });

  it('douyin 白名单只开放 3 个 action', async () => {
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'douyin', action: 'send_message' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('action_not_allowed');
    expect(res.body.allowed).toEqual(expect.arrayContaining(['health_check', 'broadcast', 'status']));
  });
});

// ─── 功能关闭 ─────────────────────────────────────────────────────────────────

describe('RPA_DEV_VERIFY_ENABLED=false', () => {
  it('返回 503', async () => {
    process.env.RPA_DEV_VERIFY_ENABLED = 'false';
    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('rpa_dev_verify_disabled');
  });
});

// ─── 成功路径 ─────────────────────────────────────────────────────────────────

describe('成功路径', () => {
  it('代理请求到 Agent，返回 stdout + exit_code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ exit_code: 0, stdout: 'pong', stderr: '' }),
    });

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check', params: {}, timeout_ms: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.exit_code).toBe(0);
    expect(res.body.stdout).toBe('pong');
    expect(typeof res.body.elapsed_ms).toBe('number');
  });

  it('publish line cdp_click 成功', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ exit_code: 0, stdout: 'clicked', stderr: '' }),
    });

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'publish', action: 'cdp_click', params: { selector: '#btn' } });

    expect(res.status).toBe(200);
    expect(res.body.exit_code).toBe(0);
  });

  it('timeout_ms 超过上限时自动截断到 60s', async () => {
    let capturedBody;
    mockFetch.mockImplementationOnce(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ exit_code: 0, stdout: '', stderr: '' }) };
    });

    await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check', timeout_ms: 999_999 });

    expect(capturedBody.timeout_ms).toBe(60_000);
  });
});

// ─── 失败路径 ─────────────────────────────────────────────────────────────────

describe('失败路径', () => {
  it('Agent 不可达 → 502 agent_unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('agent_unreachable');
    expect(res.body.message).toContain('ECONNREFUSED');
  });

  it('AbortError（HTTP 超时）→ 504 timeout', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    mockFetch.mockRejectedValueOnce(err);

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check', timeout_ms: 100 });

    expect(res.status).toBe(504);
    expect(res.body.error).toBe('timeout');
    expect(res.body.timeout_ms).toBe(100);
  });

  it('Agent 返回 5xx → 502 agent_error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    });

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'douyin', action: 'broadcast' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('agent_error');
    expect(res.body.agent_status).toBe(500);
  });

  it('Agent 返回非 JSON → 502 agent_invalid_json', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    const res = await request(makeApp())
      .post('/api/brain/rpa/dev-verify')
      .send({ line: 'wechat', action: 'health_check' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('agent_invalid_json');
  });
});
