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
      const sentinelCall = pool.query.mock.calls.find(([sql, params]) => sql.includes('working_memory') && sql.includes('INSERT') && params[0] === 'machine_vitals_stale_alert');
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
      const sentinelCall = pool.query.mock.calls.find(([sql, params]) => sql.includes('working_memory') && sql.includes('INSERT') && params[0] === 'machine_vitals_stale_alert');
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

    // PRD 需求 2 / 事故实证②：machine_vitals_stale_alert 卡 2 天的根因——
    // 旧代码只在「本进程内 _staleAlerted=true」时才清哨兵；Brain 重启后内存 flag 归零，
    // 哨兵行却留在 working_memory，采样恢复也永不清除。修法：采样成功无条件幂等 DELETE 哨兵行，
    // restart 后残留也能被下一次成功采样自愈。
    it('采样成功无条件清除 stale 哨兵（restart 后 in-memory flag 丢失也能自愈）', async () => {
      const pool = makePool();
      // 全新进程、未经历本进程内告警（_staleAlerted 始终 false），直接一次成功采样
      stubDocker({ psNames: '', memUsage: '' });
      await sampleMachineVitals(pool);
      const deleteCall = pool.query.mock.calls.find(
        ([sql, params]) => sql.includes('DELETE FROM working_memory') && params?.[0] === 'machine_vitals_stale_alert',
      );
      expect(deleteCall).toBeTruthy();
    });
  });

  describe('machine_vitals_daily_peak 峰值滚动', () => {
    function poolMock() { return { query: vi.fn().mockResolvedValue({ rows: [] }) }; }
    function peakUpsertCalls(pool) {
      // 只算 INSERT（回读 SELECT 同含键名，不计入写入次数）
      return pool.query.mock.calls.filter(([sql]) => String(sql).includes('machine_vitals_daily_peak') && String(sql).includes('INSERT'));
    }
    function lastPeakValue(pool) {
      const calls = peakUpsertCalls(pool);
      const params = calls[calls.length - 1][1];
      return JSON.parse(params[0]); // 实现里 key 写死在 SQL 内，$1=value_json，params[0]
    }

    it('同日两次采样 5→3：peak 保持 5', async () => {
      const pool = poolMock();
      stubDocker({ psNames: Array.from({length:5},(_,i)=>`cecelia-relay-x${i}-1`).join('\n') + '\n' });
      await sampleMachineVitals(pool);
      stubDocker({ psNames: 'cecelia-relay-a-1\ncecelia-relay-b-2\ncecelia-relay-c-3\n' });
      await sampleMachineVitals(pool);
      expect(lastPeakValue(pool).peak).toBe(5);
      // 锁写入频次语义：非新峰不重复写（reviewer 建议）
      expect(peakUpsertCalls(pool)).toHaveLength(1);
    });

    it('重启后回读 DB 同日峰值：内存镜像丢失 + DB 存 5 + 当前 2 容器 → 不抹低，写回 5（终审 P2）', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      const pool = {
        query: vi.fn(async (sql) => {
          if (String(sql).includes('SELECT') && String(sql).includes('machine_vitals_daily_peak')) {
            return { rows: [{ value_json: { date: today, peak: 5 } }] };
          }
          return { rows: [] };
        }),
      };
      stubDocker({ psNames: 'cecelia-relay-a-1\ncecelia-relay-b-2\n' });
      await sampleMachineVitals(pool);
      expect(lastPeakValue(pool).peak).toBe(5);
    });

    it('采样失败不写峰值', async () => {
      const pool = poolMock();
      stubDocker({ fail: 'docker down' });
      await sampleMachineVitals(pool);
      expect(peakUpsertCalls(pool)).toHaveLength(0);
    });

    it('无 pool 不抛错且不写', async () => {
      stubDocker({ psNames: 'cecelia-relay-a-1\n' });
      await expect(sampleMachineVitals()).resolves.toBeTruthy();
    });

    it('跨日重置：新一天首次采样 peak=当日值（不沿用前一日峰值）', async () => {
      const pool = poolMock();
      stubDocker({ psNames: Array.from({length:5},(_,i)=>`cecelia-relay-x${i}-1`).join('\n') + '\n' });
      await sampleMachineVitals(pool);
      expect(lastPeakValue(pool).peak).toBe(5);

      // 模拟跨日：直接重置峰值内存态（等价于新一天首次采样前的状态）
      _resetVitalsCacheForTest();
      pool.query.mockClear();
      stubDocker({ psNames: 'cecelia-relay-a-1\ncecelia-relay-b-2\n' });
      await sampleMachineVitals(pool);
      expect(lastPeakValue(pool).peak).toBe(2);
    });
  });
});
