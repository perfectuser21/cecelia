/**
 * incident-reporter.js 配套单元测试
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 *
 * 完整覆盖见 tests/regression/incidents-layer/incident-reporter.test.js
 * 本文件确保 lint-test-pairing 找到配套 test。
 *
 * 覆盖：
 *   [BEHAVIOR-2] 首次调用插入记录
 *   [BEHAVIOR-3] 幂等去重（同 fingerprint 累加 recurrence_count）
 *   [BEHAVIOR-5] 失败不抛出，不阻塞调用方
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB pool ──────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
}));

// ── 被测模块 ──────────────────────────────────────────────────────────────────
let reportIncident;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('../incident-reporter.js');
  reportIncident = mod.reportIncident;
});

describe('[BEHAVIOR-2] reportIncident() 首次调用', () => {
  it('应执行 INSERT ON CONFLICT 语句', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'test' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO incidents/i);
    expect(sql).toMatch(/ON CONFLICT.*fingerprint/i);
    expect(params).toContain('launchd-patrol');
    expect(params).toContain('launchd-patrol:com.cecelia.bridge');
    expect(params).toContain('p1');
  });
});

describe('[BEHAVIOR-3] 幂等去重', () => {
  it('两次调用各发一条 SQL（ON CONFLICT 处理去重，不新增行）', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'first' });
    await reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'second' });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const [sql] of mockQuery.mock.calls) {
      expect(sql).toMatch(/recurrence_count\s*=\s*recurrence_count\s*\+\s*1/i);
    }
  });
});

describe('[BEHAVIOR-5] 非阻塞容错', () => {
  it('DB 抛出异常时 Promise 应 resolve（不 reject）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      reportIncident('test', 'test:x', 'p2', {})
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
