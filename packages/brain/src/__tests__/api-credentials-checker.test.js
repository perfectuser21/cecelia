/**
 * api-credentials-checker tests
 *
 * 验证 Anthropic API + OpenAI 直连凭据健康检查
 * Mock fetch 模拟各种响应（200 OK / 400 余额不足 / 429 quota / 401 unauthorized / network error）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkAnthropicApi,
  checkOpenAI,
  checkAllApiCredentials,
} from '../api-credentials-checker.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkAnthropicApi', () => {
  it('200 success → healthy=true status=ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    const r = await checkAnthropicApi({ fetchFn, apiKey: 'sk-test' });
    expect(r).toMatchObject({ provider: 'anthropic-api', healthy: true, status: 'ok' });
  });

  it('400 credit balance 太低 → errorType=credit_balance_too_low', async () => {
    const body = '{"error":{"message":"Your credit balance is too low"}}';
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve(body) });
    const r = await checkAnthropicApi({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy).toBe(false);
    expect(r.errorType).toBe('credit_balance_too_low');
  });

  it('401 unauthorized → errorType=unauthorized', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('Invalid API key') });
    const r = await checkAnthropicApi({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy).toBe(false);
    expect(r.errorType).toBe('unauthorized');
  });

  it('网络错误 → status=network_error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkAnthropicApi({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy).toBe(false);
    expect(r.status).toBe('network_error');
  });

  it('无 API key → status=no_key', async () => {
    const r = await checkAnthropicApi({ fetchFn: vi.fn(), apiKey: undefined });
    expect(r.healthy).toBe(false);
    expect(r.status).toBe('no_key');
  });
});

describe('checkOpenAI', () => {
  it('200 → healthy=true', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    const r = await checkOpenAI({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy).toBe(true);
  });

  it('429 insufficient_quota → errorType=quota_exceeded', async () => {
    const body = '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}';
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve(body) });
    const r = await checkOpenAI({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy).toBe(false);
    expect(r.errorType).toBe('quota_exceeded');
  });

  it('401 → errorType=unauthorized', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('') });
    const r = await checkOpenAI({ fetchFn, apiKey: 'sk-test' });
    expect(r.errorType).toBe('unauthorized');
  });

  it('无 API key → status=no_key', async () => {
    const r = await checkOpenAI({ fetchFn: vi.fn(), apiKey: undefined });
    expect(r.status).toBe('no_key');
  });
});

describe('checkAllApiCredentials', () => {
  it('两 provider 都健康 → summary=all_healthy', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    const r = await checkAllApiCredentials({ fetchFn, apiKey: 'sk-test' });
    expect(r.summary).toBe('all_healthy');
    expect(r.healthy_providers).toEqual(['anthropic-api', 'openai']);
    expect(r.unhealthy_providers).toEqual([]);
  });

  it('两 provider 都失败 → summary=some_failed', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('credit balance too low') });
    const r = await checkAllApiCredentials({ fetchFn, apiKey: 'sk-test' });
    expect(r.summary).toBe('some_failed');
    expect(r.unhealthy_providers).toEqual(['anthropic-api', 'openai']);
  });

  it('只一个失败 → unhealthy_providers 列出来', async () => {
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('insufficient_quota') }));
    const r = await checkAllApiCredentials({ fetchFn, apiKey: 'sk-test' });
    expect(r.healthy_providers).toEqual(['anthropic-api']);
    expect(r.unhealthy_providers).toEqual(['openai']);
  });
});
