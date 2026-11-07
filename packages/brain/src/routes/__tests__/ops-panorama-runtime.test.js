import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import express from 'express';
const state = vi.hoisted(() => ({ sleep: true, neverLlm: false, error: false, children: [], syncCalls: 0 }));
vi.mock('child_process', async (importOriginal) => {
  const cp = await importOriginal();
  const output = (file) => file === 'docker' || file.includes('docker') ? 'cecelia-relay-one\n' :
    file.includes('wc') ? '1\n' : '101 1 30 claude claude\n102 1 20 codex codex\n';
  return { ...cp,
    execSync: (command) => { state.syncCalls++; if (state.sleep) cp.execSync('/bin/sleep 0.12'); return output(command); },
    execFile: (file, args, options, callback) => {
      const command = state.sleep ? '/bin/sleep' : '/bin/echo';
      const child = cp.execFile(command, state.sleep ? ['0.12'] : [''], options, (err) =>
        callback(state.error ? new Error('probe unavailable') : err, output(file), ''));
      state.children.push(child); return child;
    },
  };
});
vi.mock('../../platform-utils.js', async (importOriginal) => {
  const original = await importOriginal(); const cp = await import('child_process');
  return { ...original, countClaudeProcesses: () => { cp.execSync('claude-process-count'); return 1; } };
});
vi.mock('../../llm-capacity.js', () => ({ getLlmCapacitySnapshot: vi.fn(() => state.neverLlm ? new Promise(() => {}) :
  Promise.resolve({ sentinel: 'ok', vendors: { claude: { accounts: [{ id: 'safe', token: 'must-be-removed' }] } } })) }));
vi.mock('../../slot-allocator.js', () => ({ detectUserSessions: () => ({ headed: [{ pid: 101 }], headless: [] }) }));
import router from '../ops-panorama.js';
import { getLlmCapacitySnapshot } from '../../llm-capacity.js';
const handler = router.stack.find((layer) => layer.route?.path === '/').route.stack[0].handle;
const run = (rows = [{ executor: 'codex' }]) => {
  const res = { json: vi.fn() };
  const promise = handler({ app: { locals: { pool: { query: async () => ({ rows }) } } } }, res);
  return { promise, res };
};
beforeEach(() => { state.sleep = true; state.error = false; state.neverLlm = false; state.syncCalls = 0; vi.clearAllMocks(); });
afterEach(() => { state.children.forEach((child) => child.kill('SIGKILL')); state.children = []; vi.useRealTimers(); });
describe('ops-panorama 真实router同步阻塞回归', () => {
  it('现役账号的采集状态经真实接口返回且敏感字段继续移除', async () => {
    state.sleep = false;
    vi.mocked(getLlmCapacitySnapshot).mockResolvedValueOnce({ sentinel: 'ok', vendors: {
      codex: { poller: 'error', error: 'private detail', accounts: [{ name: 'team1', source: 'ledger:unknown:no_data', available: true, token: 'private token' }] },
      grok: { poller: 'ok', accounts: [{ name: 'grok', source: 'ledger:unusable:exhausted', available: false }] },
    } });
    const { promise, res } = run(); await promise;
    const capacity = res.json.mock.calls[0][0].llm_capacity;
    expect(capacity.vendors.codex.poller).toBe('error');
    expect(capacity.vendors.grok.poller).toBe('ok');
    expect(JSON.stringify(capacity)).not.toContain('private');
  });
  it('本机sleep子进程探测不能在构造Promise.all时同步堵住handler和timer', async () => {
    let heartbeatAt;
    const start = performance.now();
    const heartbeat = new Promise((resolve) => setTimeout(() => { heartbeatAt = performance.now() - start; resolve(); }, 15));
    const { promise, res } = run();
    const returnedAt = performance.now() - start;
    await Promise.all([promise, heartbeat]);
    expect(res.json).toHaveBeenCalledOnce();
    expect(returnedAt).toBeLessThan(90);
    expect(heartbeatAt).toBeLessThan(90);
    expect(state.syncCalls).toBe(0);
  });
  it('真实HTTP全景探测运行时其它健康请求立即响应', async () => {
    const app = express(); app.locals.pool = { query: async () => ({ rows: [] }) };
    app.use('/ops-panorama', router); app.get('/health', (_req, res) => res.json({ ok: true }));
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      let panoramaDone = false;
      const panorama = fetch(`${base}/ops-panorama`).then(async (res) => { const body = await res.json(); panoramaDone = true; return body; });
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
      expect(panoramaDone).toBe(false);
      expect((await panorama).processes).toEqual({ claude_total: 1, codex_total: 1 });
    } finally { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); }
  });
  it('保留字段shape、精确进程计数、账号去凭据和原缓存读取入口', async () => {
    state.sleep = false;
    const { promise, res } = run(); await promise;
    const response = res.json.mock.calls[0][0];
    expect(response).toMatchObject({ tasks: { in_progress_count: 1, vendor_dist: { claude: 0, codex: 1, grok: 0, unknown: 0 } },
      relay: { container_count: 1 }, sessions: { headed: 1, headless: 0 }, processes: { claude_total: 1, codex_total: 1 } });
    expect(response.sampled_at).toBeTruthy(); expect(response.host.cpu_usage_pct).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(response.llm_capacity)).not.toContain('must-be-removed');
    expect(getLlmCapacitySnapshot).toHaveBeenCalledWith();
  });
  it('进程失败保持HTTP响应合法而非500', async () => {
    state.sleep = false; state.error = true;
    const { promise, res } = run(); await promise;
    expect(res.json.mock.calls[0][0]).toMatchObject({ relay: { container_count: null },
      processes: { claude_total: null, codex_total: null, available: false }, sessions: { headed: null, headless: null } });
  });
  it('实际任务查询把缺失和未知执行器各计一次，不增添未知厂商键', async () => {
    state.sleep = false;
    const {promise, res} = run([{executor: 'claude'}, {executor: null}, {executor: 'retired-provider'}]);
    await promise;
    expect(res.json.mock.calls[0][0].tasks).toEqual({in_progress_count: 3,
      vendor_dist: {claude: 1, codex: 0, grok: 0, unknown: 2}});
  });
  it('实际LLM来源失败只降级该字段，不吞任务数据或暴露账号凭据', async () => {
    state.sleep = false;
    vi.mocked(getLlmCapacitySnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'));
    const {promise, res} = run();
    await promise;
    const body = res.json.mock.calls[0][0];
    expect(body.llm_capacity).toBeNull();
    expect(body.tasks).toEqual({in_progress_count: 1, vendor_dist: {claude: 0, codex: 1, grok: 0, unknown: 0}});
    expect(body.host.mem_used_pct).toBeGreaterThanOrEqual(0);
  });
  it('LLM慢源严格5s降级，timer不残留且不修改原缓存API', async () => {
    state.sleep = false; state.neverLlm = true; vi.useFakeTimers();
    const { promise, res } = run();
    // 等真实子进程回调（fake timer不接管OS回调）。
    await vi.waitFor(() => expect(state.children.every((child) => child.exitCode !== null)).toBe(true), { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(5001); await promise;
    expect(res.json.mock.calls[0][0].llm_capacity).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('任务查询失败返回unknown而非空闲零', async () => {
  state.sleep = false;
  const res = { json: vi.fn() };
  await handler({ app: { locals: { pool: { query: vi.fn().mockRejectedValue(new Error('database unavailable')) } } } }, res);
  expect(res.json.mock.calls[0][0].tasks).toMatchObject({ in_progress_count: null, vendor_dist: null, available: false, sampled_at: null });
});
