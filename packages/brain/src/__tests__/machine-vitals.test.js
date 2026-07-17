import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock 只打在 child_process 系统边界（禁 mock 模块内部函数）
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  sampleMachineVitals, getMachineVitals, STALE_MS,
  _resetVitalsCacheForTest, _setVitalsCacheForTest,
} from '../machine-vitals.js';

// execFile(cmd, args, opts, cb) → 按 args 派发假输出
function stubDocker({ psNames = '', memTotal = String(8 * 1024 ** 3), memUsage = '', dfHost = 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3s5 100 50 50 50% /', fail = null } = {}) {
  execFileMock.mockImplementation((cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    if (fail) return done(new Error(fail));
    if (cmd === 'docker' && args[0] === 'ps') return done(null, psNames, '');
    if (cmd === 'docker' && args[0] === 'info') return done(null, memTotal, '');
    if (cmd === 'docker' && args[0] === 'stats') return done(null, memUsage, '');
    if (cmd === 'df') return done(null, dfHost, '');
    return done(new Error(`unexpected: ${cmd} ${args.join(' ')}`));
  });
}

describe('machine-vitals', () => {
  beforeEach(() => { _resetVitalsCacheForTest(); execFileMock.mockReset(); });

  it('采样成功：relay 容器按前缀计数，其他容器不算', async () => {
    stubDocker({
      psNames: 'cecelia-relay-aaa-111\ncecelia-relay-bbb-222\ncecelia-task-ccc-333\ncecelia-node-brain\n',
      memUsage: '512MiB / 8GiB\n1.5GiB / 8GiB\n',
    });
    await sampleMachineVitals();
    const v = getMachineVitals();
    expect(v.relay_count).toBe(2);
    expect(v.relay_containers).toEqual(['cecelia-relay-aaa-111', 'cecelia-relay-bbb-222']);
    expect(v.vm_total_mb).toBe(8192);
    expect(v.vm_used_mb).toBe(512 + 1536);
    expect(v.host_disk_pct).toBe(50);
    expect(v.error).toBeNull();
    expect(v.stale).toBe(false);
  });

  it('docker 命令失败：error 进缓存', async () => {
    stubDocker({ fail: 'docker daemon down' });
    await sampleMachineVitals();
    const v = getMachineVitals();
    expect(v.error).toMatch(/docker daemon down/);
  });

  it('从未采样：never_sampled + stale', () => {
    const v = getMachineVitals();
    expect(v.error).toBe('never_sampled');
    expect(v.stale).toBe(true);
  });

  it('缓存超 STALE_MS：stale=true', () => {
    _setVitalsCacheForTest({ sampled_at: Date.now() - STALE_MS - 1000, relay_count: 1, error: null });
    expect(getMachineVitals().stale).toBe(true);
  });

  it('缓存新鲜：stale=false', () => {
    _setVitalsCacheForTest({ sampled_at: Date.now() - 5000, relay_count: 1, error: null });
    expect(getMachineVitals().stale).toBe(false);
  });
});
