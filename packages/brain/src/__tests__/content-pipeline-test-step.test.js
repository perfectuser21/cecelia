import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: call }));
import router from '../routes/content-pipeline.js';
const app = express(); app.use(express.json()); app.use(router);
beforeEach(() => call.mockReset().mockResolvedValue({ text: 'controlled output', elapsed_ms: 2 }));
describe('真实test-step路由provider选择', () => {
  it.each([
    [undefined, 'claude-sonnet-4-20250514', 'anthropic'],
    [undefined, 'claude-opus-4-20250514', 'anthropic'],
    [undefined, 'gpt-4o', 'openai'],
    ['anthropic-api', 'claude-sonnet-4-20250514', 'anthropic-api'],
    ['anthropic', 'gpt-4o', 'anthropic'],
    ['openai', 'claude-opus-4-20250514', 'openai'],
    ['', 'gpt-4o', 'openai'],
  ])('provider=%s model=%s选择%s', async (provider, model, expected) => {
    const response = await request(app).post('/content-types/test-step').send({ step: 'content-research', prompt: 'controlled prompt', model, provider });
    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith('content-test-step', expect.stringContaining('controlled prompt'), expect.objectContaining({ provider: expected, model }));
    expect(response.body.output).toBe('controlled output');
  });
  it('非法step不会触及模型边界', async () => {
    const response = await request(app).post('/content-types/test-step').send({ step: 'unknown', prompt: 'x' });
    expect(response.status).toBe(400); expect(call).not.toHaveBeenCalled();
  });
});
