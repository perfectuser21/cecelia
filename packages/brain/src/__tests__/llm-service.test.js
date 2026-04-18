/**
 * llm-service 路由 + internal-auth 中间件单元测试
 *
 * 覆盖：
 *   - 正常请求 → success:true + data.text/content
 *   - 参数校验：tier 缺失/非法、prompt 空、max_tokens 超上限、timeout 超上限、format 非法
 *   - callLLM 抛错 → 500 error.code=LLM_CALL_FAILED
 *   - callLLM 超时 → 500 error.code=LLM_TIMEOUT
 *   - 鉴权：env 未设 + 无 token → 放行；env 设 + 无 token → 401；env 设 + 错 token → 401；
 *     env 设 + Bearer 对 token → 200；env 设 + X-Internal-Token 对 token → 200
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- Mock callLLM ----
const { mockCallLLM } = vi.hoisted(() => ({
  mockCallLLM: vi.fn(),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

async function buildApp({ withAuth = true } = {}) {
  vi.resetModules();
  const routesMod = await import('../routes/llm-service.js');
  const app = express();
  app.use(express.json());
  if (withAuth) {
    const authMod = await import('../middleware/internal-auth.js');
    authMod._resetInternalAuthWarning();
    app.use('/api/brain/llm-service', authMod.internalAuth, routesMod.default);
  } else {
    app.use('/api/brain/llm-service', routesMod.default);
  }
  return app;
}

describe('POST /api/brain/llm-service/generate', () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  afterEach(() => {
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  it('正常请求 → success:true + data.text/content/model/provider', async () => {
    mockCallLLM.mockResolvedValue({
      text: '你好世界',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic-api',
      elapsed_ms: 1234,
    });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: '你好' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toBe('你好世界');
    expect(res.body.data.content).toBe('你好世界');
    expect(res.body.data.model).toBe('claude-haiku-4-5-20251001');
    expect(res.body.data.provider).toBe('anthropic-api');
    expect(res.body.data.tier).toBe('thalamus');
    expect(res.body.data.elapsed_ms).toBe(1234);
    expect(res.body.error).toBeNull();
    expect(mockCallLLM).toHaveBeenCalledWith('thalamus', '你好', expect.objectContaining({
      maxTokens: 2048,
      timeout: 180_000,
    }));
  });

  it('tier 缺失 → 400 INVALID_TIER', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ prompt: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('tier 非法 → 400 INVALID_TIER', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'unknown', prompt: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('prompt 空 → 400 INVALID_PROMPT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROMPT');
  });

  it('max_tokens 超上限 → 400 INVALID_MAX_TOKENS', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x', max_tokens: 999999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MAX_TOKENS');
  });

  it('timeout 超上限 → 400 INVALID_TIMEOUT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x', timeout: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMEOUT');
  });

  it('format 非法 → 400 INVALID_FORMAT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x', format: 'xml' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  it('format=json 追加 JSON hint 到 prompt', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"ok":1}', model: 'm', provider: 'p' });
    const app = await buildApp();
    await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: '给个对象', format: 'json' });
    const [, passedPrompt] = mockCallLLM.mock.calls[0];
    expect(passedPrompt).toContain('给个对象');
    expect(passedPrompt).toContain('JSON');
  });

  it('callLLM 抛普通错 → 500 LLM_CALL_FAILED', async () => {
    mockCallLLM.mockRejectedValue(new Error('boom'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('LLM_CALL_FAILED');
  });

  it('callLLM timeout → 500 LLM_TIMEOUT', async () => {
    const err = new Error('LLM call timed out after 180000ms');
    err.degraded = true;
    mockCallLLM.mockRejectedValue(err);
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
  });

  it('callLLM 401 → 500 LLM_AUTH_FAILED', async () => {
    const err = new Error('unauthorized');
    err.status = 401;
    mockCallLLM.mockRejectedValue(err);
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('LLM_AUTH_FAILED');
  });
});

describe('internal-auth 中间件', () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
    mockCallLLM.mockResolvedValue({ text: 'ok', model: 'm', provider: 'p' });
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  afterEach(() => {
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  it('env 未设 + 无 token → 放行', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(200);
  });

  it('env 设 + 无 token → 401', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret-123';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('env 设 + 错 token → 401', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret-123';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .set('Authorization', 'Bearer wrong-token')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('env 设 + Bearer 对 token → 200', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret-123';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .set('Authorization', 'Bearer secret-123')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('env 设 + X-Internal-Token 对 token → 200', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret-123';
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/generate')
      .set('X-Internal-Token', 'secret-123')
      .send({ tier: 'thalamus', prompt: 'x' });
    expect(res.status).toBe(200);
  });
});
