import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { runBoundedProbe, probeProcesses, probeRelayContainers } from '../ops-panorama-probes.js';
const snapshot = `10 1 00:30 claude claude\n11 20 00:40 claude claude renamed-title\n12 1 00:50 claude claude -p task\n13 1 2-00:00:00 claude claude\n14 1 00:30 codex codex\n15 1 00:30 bash grep codex\n20 1 00:30 env env CECELIA_HEADLESS=true claude\n`;
const request = (output) => vi.fn((_file, _args, options, callback) => { callback(null, output); return {}; });
describe('ops-panorama-probes 真异步有界进程探测', () => {
  it('本机真实sleep超时被SIGKILL结束，timer在子进程运行时仍响应', async () => {
    let heartbeat = false; const start = performance.now();
    const timer = setTimeout(() => { heartbeat = true; }, 15);
    const output = await runBoundedProbe('/bin/sleep', ['1'], { timeoutMs: 90 });
    clearTimeout(timer);
    expect(output).toBeNull(); expect(heartbeat).toBe(true);
    expect(performance.now() - start).toBeLessThan(700);
  });
  it('真实只读ps探测返回数值形状，不调用生产API', async () => {
    const result = await probeProcesses();
    expect(result.claude_total).toBeGreaterThanOrEqual(0); expect(result.codex_total).toBeGreaterThanOrEqual(0);
    expect(result.sessions.headed).toBeGreaterThanOrEqual(0); expect(result.sessions.headless).toBeGreaterThanOrEqual(0);
  });
  it.each(['darwin', 'linux'])('%s保持精确claude、codex排grep、TTL与父进程headless口径', async (platform) => {
    const data = platform === 'linux' ? snapshot.replaceAll('00:30', '30').replaceAll('00:40', '40').replaceAll('00:50', '50').replaceAll('2-00:00:00', '172800') : snapshot;
    const execFileFn = request(data);
    expect(await probeProcesses({ platform, execFileFn })).toEqual({ claude_total: 4, codex_total: 1,
      sessions: { headed: 1, headless: 2 } });
    expect(execFileFn.mock.calls[0][0]).toBe('ps');
    expect(execFileFn.mock.calls[0][2]).toMatchObject({ timeout: 3000, killSignal: 'SIGKILL' });
  });
  it('进程读取失败/损坏行返回0与合法形状', async () => {
    const failing = vi.fn((_file, _args, _options, callback) => callback(new Error('unavailable')));
    expect(await probeProcesses({ execFileFn: failing })).toEqual({ claude_total: 0, codex_total: 0, sessions: { headed: 0, headless: 0 } });
    expect(await probeProcesses({ execFileFn: request('bad line\n'), platform: 'linux' })).toEqual({ claude_total: 0, codex_total: 0, sessions: { headed: 0, headless: 0 } });
  });
  it('docker有界读取正常计数，失败降级null', async () => {
    expect(await probeRelayContainers({ execFileFn: request('cecelia-relay-a\ncecelia-relay-b\n') })).toBe(2);
    const failing = vi.fn((_file, _args, _options, callback) => callback(new Error('missing docker')));
    expect(await probeRelayContainers({ execFileFn: failing })).toBeNull();
  });
});
