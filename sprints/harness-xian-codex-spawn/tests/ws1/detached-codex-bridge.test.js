import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnCodexBridgeDetached } from '../../../../packages/brain/src/spawn/detached.js';

describe('spawnCodexBridgeDetached [BEHAVIOR]', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('可从模块导出，类型为 function', () => {
    expect(typeof spawnCodexBridgeDetached).toBe('function');
  });

  it('payload 包含 task_id / task_type / callback_url，POST 到 bridgeUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'accepted', job_id: 'job-abc-123' }),
    });
    global.fetch = mockFetch;

    const result = await spawnCodexBridgeDetached('http://bridge:3458/run', {
      task_id: 'task-uuid-001',
      task_type: 'harness_generate',
      callback_url: 'http://brain:5221/api/brain/harness/callback/job-abc-123',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://bridge:3458/run');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      task_id: 'task-uuid-001',
      task_type: 'harness_generate',
      callback_url: 'http://brain:5221/api/brain/harness/callback/job-abc-123',
    });

    expect(result).toEqual({ status: 'accepted', job_id: 'job-abc-123' });
  });

  it('Bridge 返回非 200 时 throw（供 spawnNode catch fallback）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'service unavailable' }),
    });

    await expect(
      spawnCodexBridgeDetached('http://bridge:3458/run', {
        task_id: 'task-uuid-002',
        task_type: 'harness_generate',
        callback_url: 'http://brain:5221/api/brain/harness/callback/job-x',
      })
    ).rejects.toThrow();
  });

  it('Bridge 响应缺少 status=accepted 时 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, job_id: 'job-xyz' }),
    });

    await expect(
      spawnCodexBridgeDetached('http://bridge:3458/run', {
        task_id: 'task-uuid-003',
        task_type: 'harness_generate',
        callback_url: 'http://brain:5221/api/brain/harness/callback/job-y',
      })
    ).rejects.toThrow(/status.*accepted/i);
  });

  it('Bridge 响应 job_id 非 string 时 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'accepted', job_id: 42 }),
    });

    await expect(
      spawnCodexBridgeDetached('http://bridge:3458/run', {
        task_id: 'task-uuid-004',
        task_type: 'harness_generate',
        callback_url: 'http://brain:5221/api/brain/harness/callback/job-z',
      })
    ).rejects.toThrow(/job_id/i);
  });
});
