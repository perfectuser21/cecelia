/**
 * 测试：capability-probe 连续失败自动回滚机制
 *
 * 覆盖：
 * - checkConsecutiveFailures：历史不足 / 中间有成功 / 连续失败达阈值
 * - executeRollback：脚本不存在降级 / 成功 / 失败
 * - runProbeCycle 回滚集成：单次失败不触发 / 连续失败触发
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock 所有外部依赖 ──────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn().mockReturnValue(false),
  dispatchToDevSkill: vi.fn().mockResolvedValue('mock-task-id'),
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../executor.js', () => ({
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  MAX_SEATS: 10,
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(),
}));

vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn().mockReturnValue({ running: true, interval_ms: 30000 }),
}));

// child_process 和 fs 的 mock 在具体 test 中按需覆写
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// ── 辅助函数 ──────────────────────────────────────────────────

/**
 * 构造 cecelia_events 中 capability_probe 历史记录行。
 * @param {Array<{name: string, ok: boolean}[]>} batches - 每个元素是一次批次的探针结果
 */
function makeHistoryRows(batches) {
  return batches.map((probeList) => ({
    payload: JSON.stringify({
      timestamp: new Date().toISOString(),
      total: probeList.length,
      failed: probeList.filter((p) => !p.ok).length,
      probes: probeList.map((p) => ({
        name: p.name,
        ok: p.ok,
        detail: '',
        latency_ms: 10,
        error: p.ok ? null : 'mock error',
      })),
    }),
  }));
}

// ── Tests ──────────────────────────────────────────────────────

describe('checkConsecutiveFailures', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('历史记录不足时不触发回滚', async () => {
    const pool = (await import('../db.js')).default;
    // 只有 2 条历史，阈值为 3
    pool.query.mockResolvedValueOnce({
      rows: makeHistoryRows([
        [{ name: 'db', ok: false }],
        [{ name: 'db', ok: false }],
      ]),
    });

    const { checkConsecutiveFailures } = await import('../capability-probe.js');
    const result = await checkConsecutiveFailures('db', 3);

    expect(result.shouldRollback).toBe(false);
    expect(result.consecutive).toBeLessThan(3);
  });

  it('中间有一次成功时连续失败链断开，不触发回滚', async () => {
    const pool = (await import('../db.js')).default;
    // 最近一次失败，中间一次成功，更早一次失败
    pool.query.mockResolvedValueOnce({
      rows: makeHistoryRows([
        [{ name: 'db', ok: false }], // 最近
        [{ name: 'db', ok: true }],  // 成功 → 断链
        [{ name: 'db', ok: false }], // 更早
      ]),
    });

    const { checkConsecutiveFailures } = await import('../capability-probe.js');
    const result = await checkConsecutiveFailures('db', 3);

    expect(result.shouldRollback).toBe(false);
    expect(result.consecutive).toBe(1);
  });

  it('连续失败 3 次时触发回滚', async () => {
    const pool = (await import('../db.js')).default;
    pool.query.mockResolvedValueOnce({
      rows: makeHistoryRows([
        [{ name: 'db', ok: false }],
        [{ name: 'db', ok: false }],
        [{ name: 'db', ok: false }],
      ]),
    });

    const { checkConsecutiveFailures } = await import('../capability-probe.js');
    const result = await checkConsecutiveFailures('db', 3);

    expect(result.shouldRollback).toBe(true);
    expect(result.consecutive).toBe(3);
  });

  it('探针名称不匹配时视为该探针成功（不连续）', async () => {
    const pool = (await import('../db.js')).default;
    // dispatch 探针失败，但查询的是 db 探针
    pool.query.mockResolvedValueOnce({
      rows: makeHistoryRows([
        [{ name: 'dispatch', ok: false }],
        [{ name: 'dispatch', ok: false }],
        [{ name: 'dispatch', ok: false }],
      ]),
    });

    const { checkConsecutiveFailures } = await import('../capability-probe.js');
    const result = await checkConsecutiveFailures('db', 3);

    expect(result.shouldRollback).toBe(false);
    expect(result.consecutive).toBe(0);
  });

  it('DB 查询异常时降级返回不触发', async () => {
    const pool = (await import('../db.js')).default;
    pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const { checkConsecutiveFailures } = await import('../capability-probe.js');
    const result = await checkConsecutiveFailures('db', 3);

    expect(result.shouldRollback).toBe(false);
    expect(result.consecutive).toBe(0);
  });
});

describe('executeRollback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('回滚脚本不存在时降级返回失败（不抛出）', async () => {
    const fs = await import('fs');
    fs.existsSync.mockReturnValue(false);

    const { executeRollback } = await import('../capability-probe.js');
    const result = executeRollback('测试：脚本不存在');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('回滚脚本不存在');
  });

  it('脚本执行成功时返回 success=true', async () => {
    const fs = await import('fs');
    fs.existsSync.mockReturnValue(true);

    const { spawnSync } = await import('child_process');
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '=== Rollback SUCCESS ===',
      stderr: '',
      error: null,
    });

    const { executeRollback } = await import('../capability-probe.js');
    const result = executeRollback('测试：回滚成功');

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('脚本执行失败时返回 success=false 含 exitCode', async () => {
    const fs = await import('fs');
    fs.existsSync.mockReturnValue(true);

    const { spawnSync } = await import('child_process');
    spawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Image not found',
      error: null,
    });

    const { executeRollback } = await import('../capability-probe.js');
    const result = executeRollback('测试：回滚失败');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Image not found');
  });
});

describe('真实探针周期触发回滚', () => {
  it.each([['连续失败', 1, true], ['批次失败', 5, false], ['未达阈值', 1, false]])('%s由真实编排决定是否回滚', async (_label, count, consecutive) => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
    const { PROBES, runProbeCycle } = await import('../capability-probe.js');
    const original = PROBES.slice();
    const pool = (await import('../db.js')).default;
    const { raise } = await import('../alerting.js');
    const { spawnSync } = await import('child_process');
    const { existsSync } = await import('fs');
    existsSync.mockReturnValue(true);
    spawnSync.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' });
    pool.query.mockImplementation(async sql => ({ rows: sql.includes('SELECT') && consecutive
      ? makeHistoryRows(Array.from({ length: 3 }, () => [{ name: 'controlled-0', ok: false }])) : [] }));
    PROBES.splice(0, PROBES.length, ...Array.from({ length: count }, (_, i) => ({ name: `controlled-${i}`, description: 'controlled', fn: async () => ({ ok: false, detail: 'failure' }) })));
    try {
      const results = await runProbeCycle();
      expect(results).toHaveLength(count);
      const shouldRollback = count === 5 || consecutive;
      expect(spawnSync).toHaveBeenCalledTimes(shouldRollback ? 1 : 0);
      const rollbackAlerts = raise.mock.calls.filter(([, key]) => key.startsWith('probe_rollback_'));
      expect(rollbackAlerts).toHaveLength(shouldRollback ? 2 : 0);
      const persisted = pool.query.mock.calls.filter(([sql]) => sql.includes("VALUES ('probe_rollback_triggered'"));
      expect(persisted).toHaveLength(shouldRollback ? 1 : 0);
      if (shouldRollback) expect(JSON.parse(persisted[0][1][0]).rollback_success).toBe(true);
    } finally { PROBES.splice(0, PROBES.length, ...original); vi.clearAllTimers(); vi.useRealTimers(); }
  });
});
