// DB无参数时，真实rumination调用仍走API；外部请求、凭据与进程只允许合成边界。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ fetch: vi.fn(), forbidden: vi.fn(), report: vi.fn(async () => {}) }));
vi.mock('../llm-capacity.js', () => ({ CODEX_ACCOUNTS: [] }));
vi.mock('../langfuse-reporter.js', () => ({ reportCall: boundary.report }));
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
vi.mock('../alerting.js', () => ({ raise: (...args) => { boundary.forbidden('alert', ...args); throw Error('禁止通知'); } }));
vi.mock('os', () => ({ homedir: () => '/owned-rumination-fixture' }));
vi.mock('fs', () => ({ readFileSync: file => {
  if (file !== '/owned-rumination-fixture/.credentials/anthropic.json') {
    boundary.forbidden('credentials-path', file); throw Error('禁止读取真实凭据');
  }
  return JSON.stringify({ api_key: 'synthetic-rumination-api-key' });
} }));
vi.mock('child_process', () => ({ spawn: (...args) => {
  boundary.forbidden('process', ...args); throw Error('禁止启动模型进程');
} }));
import { loadActiveProfile, _resetProfileCache } from '../model-profile.js';
import { callLLM } from '../llm-caller.js';

beforeEach(async () => {
  vi.clearAllMocks();
  _resetProfileCache();
  vi.stubGlobal('fetch', boundary.fetch);
  await loadActiveProfile({ query: async () => { throw Error('owned database unavailable'); } });
});
afterEach(() => {
  expect(boundary.forbidden).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  _resetProfileCache();
});

function expectApiRequest() {
  expect(boundary.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = boundary.fetch.mock.calls[0];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(options.method).toBe('POST');
  expect(options.headers['x-api-key']).toBe('synthetic-rumination-api-key');
  expect(JSON.parse(options.body)).toMatchObject({
    messages: [{ role: 'user', content: '归纳本轮真实证据' }],
  });
}

describe('DB不可用时rumination的真实API行为', () => {
  it('参数回落后请求API并返回供应方实际文本', async () => {
    boundary.fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: '合成API返回的证据摘要' }] }) });
    const result = await callLLM('rumination', '归纳本轮真实证据');
    expectApiRequest();
    expect(result).toMatchObject({ provider: 'anthropic-api', text: '合成API返回的证据摘要' });
    expect(boundary.report).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'rumination', text: result.text }));
  });
  it('API失败不能伪造成功或恢复退休CLI，错误仍交给调用方和观测记录', async () => {
    boundary.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'owned upstream unavailable' });
    const failure = await callLLM('rumination', '归纳本轮真实证据').then(() => null, error => error);
    expectApiRequest();
    expect(failure).toBeInstanceOf(Error);
    expect(boundary.report).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'rumination', error: failure }));
  });
});
