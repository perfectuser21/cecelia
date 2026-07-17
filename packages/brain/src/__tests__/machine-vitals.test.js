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

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('machine-vitals', () => {
  beforeEach(() => { _resetVitalsCacheForTest(); execFileMock.mockReset(); vi.useRealTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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

  describe('stale 告警哨兵（终审 Fix 1）', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('无 pool 参数：跳过 DB 写，不抛错', async () => {
      stubDocker({ fail: 'docker daemon down' });
      await expect(sampleMachineVitals()).resolves.toBeTruthy();
      expect(getMachineVitals().error).toMatch(/docker daemon down/);
    });

    it('持续失败超 15min（曾成功过）→ console.error + 写哨兵键', async () => {
      const pool = makePool();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // 先来一次成功采样，建立 _lastGoodAt 基线
      stubDocker({ psNames: '', memUsage: '' });
      await sampleMachineVitals(pool);
      expect(getMachineVitals().error).toBeNull();

      // 之后持续失败，推进 >15min
      stubDocker({ fail: 'docker daemon down' });
      await sampleMachineVitals(pool);
      vi.advanceTimersByTime(16 * 60 * 1000);
      await sampleMachineVitals(pool);

      expect(errSpy).toHaveBeenCalled();
      const sentinelCall = pool.query.mock.calls.find(([sql]) => sql.includes('working_memory') && sql.includes('INSERT'));
      expect(sentinelCall).toBeTruthy();
      expect(sentinelCall[1][0]).toBe('machine_vitals_stale_alert');
      const payload = JSON.parse(sentinelCall[1][1]);
      expect(payload).toHaveProperty('since');
      expect(payload.last_error).toMatch(/docker daemon down/);
      errSpy.mockRestore();
    });

    it('never-good 冷启动：从未成功采样也在持续失败超 15min 后告警（去掉 _lastGoodAt 门）', async () => {
      const pool = makePool();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      stubDocker({ fail: 'docker daemon down（冷启动）' });

      // 首次采样尝试建立基线，此后持续失败
      await sampleMachineVitals(pool);
      expect(errSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16 * 60 * 1000);
      await sampleMachineVitals(pool);

      expect(errSpy).toHaveBeenCalled();
      const sentinelCall = pool.query.mock.calls.find(([sql]) => sql.includes('working_memory') && sql.includes('INSERT'));
      expect(sentinelCall).toBeTruthy();
      expect(sentinelCall[1][0]).toBe('machine_vitals_stale_alert');
      errSpy.mockRestore();
    });

    it('恢复采样成功：清除哨兵键', async () => {
      const pool = makePool();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      stubDocker({ fail: 'docker daemon down' });
      await sampleMachineVitals(pool);
      vi.advanceTimersByTime(16 * 60 * 1000);
      await sampleMachineVitals(pool); // 触发告警
      expect(errSpy).toHaveBeenCalled();
      pool.query.mockClear();

      stubDocker({ psNames: '', memUsage: '' });
      await sampleMachineVitals(pool); // 恢复成功
      const deleteCall = pool.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM working_memory'));
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[1][0]).toBe('machine_vitals_stale_alert');
      errSpy.mockRestore();
    });
  });
});
