/**
 * llm-service /vision 路由单元测试
 *
 * 覆盖：
 *   - 正常请求 → 200 + data.text（透传 imageContent 给 callLLM）
 *   - image_base64 缺失 → 400 INVALID_IMAGE
 *   - prompt 缺失/空 → 400 INVALID_PROMPT
 *   - image_base64 超过 5MB（base64 字符数）→ 413 IMAGE_TOO_LARGE
 *   - image_base64 误带 data: 前缀 → 400 INVALID_IMAGE
 *   - image_mime 非法 → 400 INVALID_IMAGE_MIME
 *   - tier 缺失/非法（非 thalamus/cortex）→ 400 INVALID_TIER
 *   - max_tokens / timeout 越界 → 400
 *   - format 非法 → 400
 *   - callLLM 抛普通错 → 500 LLM_CALL_FAILED
 *   - callLLM degraded（超时）→ 500 LLM_TIMEOUT
 *   - callLLM 401 → 500 LLM_AUTH_FAILED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- Mock callLLM ----
const { mockCallLLM } = vi.hoisted(() => ({
  mockCallLLM: vi.fn(),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

async function buildApp() {
  vi.resetModules();
  const routesMod = await import('../routes/llm-service.js');
  const app = express();
  // vision 路由会收大 base64，放大默认 body 限制
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/brain/llm-service', routesMod.default);
  return app;
}

// 合法的小 PNG base64（随便构造的 4 字节）
const TINY_PNG_B64 = 'iVBORw0KGgo='; // 不是真 PNG，但够小且 > 0

describe('POST /api/brain/llm-service/vision', () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  it('正常请求 → 200 + data.text，callLLM 收到 imageContent', async () => {
    mockCallLLM.mockResolvedValue({
      text: '{"V1":{"score":5,"reason":"ok"}}',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic-api',
      elapsed_ms: 456,
    });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估这张图',
        image_base64: TINY_PNG_B64,
        image_mime: 'image/png',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toContain('V1');
    expect(res.body.data.content).toBe(res.body.data.text);
    expect(res.body.data.tier).toBe('thalamus');
    expect(res.body.data.model).toBe('claude-haiku-4-5-20251001');
    expect(res.body.data.provider).toBe('anthropic-api');
    expect(res.body.error).toBeNull();

    // 验证 callLLM 拿到正确的 imageContent
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [passedTier, passedPrompt, passedOpts] = mockCallLLM.mock.calls[0];
    expect(passedTier).toBe('thalamus');
    expect(passedPrompt).toBe('评估这张图');
    expect(passedOpts).toEqual(
      expect.objectContaining({
        maxTokens: 1024,
        timeout: 60_000,
        // P0-5: vision 默认走 Claude Code 订阅 bridge（anthropic），不再走付费 anthropic-api
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        imageContent: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: TINY_PNG_B64,
            },
          },
        ],
      })
    );
  });

  it('调用方传 provider=anthropic-api → 覆盖默认 bridge 走付费 API', async () => {
    mockCallLLM.mockResolvedValue({
      text: 'ok',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic-api',
    });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
        provider: 'anthropic-api',
        model: 'claude-haiku-4-5-20251001',
      });
    expect(res.status).toBe(200);
    const [, , passedOpts] = mockCallLLM.mock.calls[0];
    expect(passedOpts.provider).toBe('anthropic-api');
    expect(passedOpts.model).toBe('claude-haiku-4-5-20251001');
  });

  it('tier 缺省 → 默认 thalamus', async () => {
    mockCallLLM.mockResolvedValue({ text: 'ok', model: 'm', provider: 'p' });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ prompt: 'x', image_base64: TINY_PNG_B64 });
    expect(res.status).toBe(200);
    expect(mockCallLLM.mock.calls[0][0]).toBe('thalamus');
  });

  it('image_base64 缺失 → 400 INVALID_IMAGE', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ tier: 'thalamus', prompt: '评估' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('image_base64 空串 → 400 INVALID_IMAGE', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ tier: 'thalamus', prompt: '评估', image_base64: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
  });

  it('image_base64 误带 data: 前缀 → 400 INVALID_IMAGE（友好提示）', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: `data:image/png;base64,${TINY_PNG_B64}`,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
    expect(res.body.error.message).toContain('data:');
  });

  it('prompt 缺失 → 400 INVALID_PROMPT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ tier: 'thalamus', image_base64: TINY_PNG_B64 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROMPT');
  });

  it('prompt 全空格 → 400 INVALID_PROMPT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ tier: 'thalamus', prompt: '   ', image_base64: TINY_PNG_B64 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROMPT');
  });

  it('image_base64 超过 5MB → 413 IMAGE_TOO_LARGE', async () => {
    const app = await buildApp();
    // 构造一个超过 ceil(5MB * 4 / 3) ≈ 6990507 字符的 base64
    const bigB64 = 'A'.repeat(7_000_000);
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({ tier: 'thalamus', prompt: '评估', image_base64: bigB64 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('image_mime 非法 → 400 INVALID_IMAGE_MIME', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
        image_mime: 'image/bmp',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE_MIME');
  });

  it('tier 不在 vision 白名单（如 mouth）→ 400 INVALID_TIER', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'mouth',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
    expect(res.body.error.message).toContain('thalamus');
  });

  it('max_tokens 越界 → 400 INVALID_MAX_TOKENS', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
        max_tokens: 999999,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MAX_TOKENS');
  });

  it('timeout 越界 → 400 INVALID_TIMEOUT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
        timeout: 99999,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMEOUT');
  });

  it('format 非法 → 400 INVALID_FORMAT', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
        format: 'xml',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  it('format=json → prompt 追加 JSON hint', async () => {
    mockCallLLM.mockResolvedValue({ text: '{}', model: 'm', provider: 'p' });
    const app = await buildApp();
    await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '给个 4 维评分',
        image_base64: TINY_PNG_B64,
        format: 'json',
      });
    const [, passedPrompt] = mockCallLLM.mock.calls[0];
    expect(passedPrompt).toContain('给个 4 维评分');
    expect(passedPrompt).toContain('JSON');
  });

  it('callLLM 抛普通错 → 500 LLM_CALL_FAILED', async () => {
    mockCallLLM.mockRejectedValue(new Error('boom'));
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
      });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('LLM_CALL_FAILED');
  });

  it('callLLM degraded → 500 LLM_TIMEOUT', async () => {
    const err = new Error('LLM call timed out after 60000ms');
    err.degraded = true;
    mockCallLLM.mockRejectedValue(err);
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
      });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
  });

  it('callLLM 401 → 500 LLM_AUTH_FAILED', async () => {
    const err = new Error('unauthorized');
    err.status = 401;
    mockCallLLM.mockRejectedValue(err);
    const app = await buildApp();
    const res = await request(app)
      .post('/api/brain/llm-service/vision')
      .send({
        tier: 'thalamus',
        prompt: '评估',
        image_base64: TINY_PNG_B64,
      });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('LLM_AUTH_FAILED');
  });
});
