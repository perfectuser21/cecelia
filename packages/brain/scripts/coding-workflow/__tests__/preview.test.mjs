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

// 审计 P0 #2：QA 验的必须正是待合并 head 的构建——预览 Brain 的 /api/brain/health 带 git_sha（部署所用提交）
describe('previewOf：绑定 head（expectSha）', () => {
  const SHA = 'b3c0930a01aa627ebcd8604a01db3aba2456b889';
  it('active 且预览 git_sha 等于期望 head → active，带 sha；查的是同一预览端口的 /health，可指定主机', async () => {
    const f = fakeFetch([{ body: { status: 'active', port: 5301 } }, { body: { status: 'healthy', git_sha: SHA } }]);
    expect(await previewOf(77, { api: 'http://x:5241', fetchImpl: f, expectSha: SHA, host: '127.0.0.1' }))
      .toEqual({ state: 'active', url: 'http://127.0.0.1:5301', port: 5301, sha: SHA });
    expect(f.calls[1]).toBe('http://127.0.0.1:5301/api/brain/health');
  });

  it('git_sha 不等（推送后还没重新部署）→ stale，带预览实际 sha；/health 查不到 → stale（sha=null）', async () => {
    let f = fakeFetch([{ body: { status: 'active', port: 5301 } }, { body: { git_sha: 'a'.repeat(40) } }]);
    expect(await previewOf(77, { api: 'a', fetchImpl: f, expectSha: SHA })).toMatchObject({ state: 'stale', sha: 'a'.repeat(40) });
    f = fakeFetch([{ body: { status: 'active', port: 5301 } }, new Error('ECONNREFUSED')]);
    expect(await previewOf(77, { api: 'a', fetchImpl: f, expectSha: SHA })).toMatchObject({ state: 'stale', sha: null });
  });

  it('waitPreview：stale 时继续等重新部署，sha 对上即返回', async () => {
    const f = fakeFetch([
      { body: { status: 'active', port: 5301 } }, { body: { git_sha: 'a'.repeat(40) } },
      { body: { status: 'active', port: 5301 } }, { body: { git_sha: SHA } },
    ]);
    expect(await waitPreview(77, { api: 'a', fetchImpl: f, expectSha: SHA, timeoutMs: 1000, intervalMs: 1 })).toMatchObject({ state: 'active', sha: SHA });
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
