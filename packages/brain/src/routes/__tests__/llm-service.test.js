import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import llmServiceRouter from '../llm-service.js';
import { callLLM } from '../../llm-caller.js';

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/llm-service', llmServiceRouter);
  return app;
}

describe('llm-service router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /generate returns success with valid tier + prompt', async () => {
    callLLM.mockResolvedValue({ text: 'generated text', model: 'claude-haiku', provider: 'anthropic' });
    const res = await request(makeApp())
      .post('/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toBe('generated text');
  });

  it('POST /generate rejects invalid tier', async () => {
    const res = await request(makeApp())
      .post('/llm-service/generate')
      .send({ tier: 'invalid_tier', prompt: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /generate rejects missing prompt', async () => {
    const res = await request(makeApp())
      .post('/llm-service/generate')
      .send({ tier: 'thalamus' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /generate rejects max_tokens above ceiling', async () => {
    const res = await request(makeApp())
      .post('/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'Hello', max_tokens: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MAX_TOKENS');
  });

  it('POST /generate handles format=json', async () => {
    callLLM.mockResolvedValue({ text: '{}', model: 'x', provider: 'y' });
    const res = await request(makeApp())
      .post('/llm-service/generate')
      .send({ tier: 'thalamus', prompt: 'give me json', format: 'json' });
    expect(res.status).toBe(200);
    expect(callLLM).toHaveBeenCalledWith('thalamus', expect.stringContaining('give me json'), expect.any(Object));
  });
});
