// lib/preview.mjs：查 PR 预览环境（MMV :5241 /api/brain/preview/status/<pr>），等它 active。
import { describe, it, expect } from 'vitest';
import { previewOf, waitPreview } from '../lib/preview.mjs';

const fakeFetch = (seq) => {
  let i = 0;
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = seq[Math.min(i++, seq.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
};

describe('previewOf', () => {
  it('active → url 用预览端口（同机 localhost）', async () => {
    const f = fakeFetch([{ body: { pr_number: 77, port: 5302, status: 'active' } }]);
    expect(await previewOf(77, { api: 'http://x:5241', fetchImpl: f })).toEqual({ state: 'active', url: 'http://localhost:5302', port: 5302 });
    expect(f.calls).toEqual(['http://x:5241/api/brain/preview/status/77']);
  });

  it('starting/deploying → pending；failed/inactive/stopped → down；404 → missing；网络错 → error', async () => {
    expect((await previewOf(1, { api: 'a', fetchImpl: fakeFetch([{ body: { status: 'starting', port: 5300 } }]) })).state).toBe('pending');
    expect((await previewOf(1, { api: 'a', fetchImpl: fakeFetch([{ body: { status: 'failed' } }]) })).state).toBe('down');
    expect((await previewOf(1, { api: 'a', fetchImpl: fakeFetch([{ body: { status: 'inactive' } }]) })).state).toBe('down');
    expect((await previewOf(1, { api: 'a', fetchImpl: fakeFetch([{ status: 404, body: {} }]) })).state).toBe('missing');
    expect((await previewOf(1, { api: 'a', fetchImpl: fakeFetch([new Error('ECONNREFUSED')]) })).state).toBe('error');
  });
});

describe('waitPreview', () => {
  it('pending 若干次后 active → 返回 active', async () => {
    const f = fakeFetch([{ body: { status: 'starting' } }, { body: { status: 'starting' } }, { body: { status: 'active', port: 5303 } }]);
    const r = await waitPreview(9, { api: 'a', fetchImpl: f, timeoutMs: 1000, intervalMs: 1 });
    expect(r).toMatchObject({ state: 'active', port: 5303 });
  });

  it('一直不 active → 超时返回最后状态', async () => {
    const r = await waitPreview(9, { api: 'a', fetchImpl: fakeFetch([{ body: { status: 'starting' } }]), timeoutMs: 20, intervalMs: 5 });
    expect(r.state).toBe('pending');
  });

  it('down / missing 立刻返回，不空等', async () => {
    const r = await waitPreview(9, { api: 'a', fetchImpl: fakeFetch([{ status: 404, body: {} }]), timeoutMs: 60000, intervalMs: 5 });
    expect(r.state).toBe('missing');
  });
});
