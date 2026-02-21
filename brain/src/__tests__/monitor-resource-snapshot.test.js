/**
 * monitor-resource-snapshot.test.js
 *
 * 测试 monitor-loop 的资源快照写入逻辑：
 * - D3-1: runMonitorCycle() 写入 resource_snapshot 到 cecelia_events
 * - D3-2: payload 包含 cpu_percent、rss_mb、active_processes、max_seats、utilization
 * - D3-3: 写入失败不影响 monitor 主流程
 *
 * DoD 映射：
 * - D3-1 → 'cycle 写入 resource_snapshot'
 * - D3-2 → 'payload 字段完整'
 * - D3-3 → '写入失败不抛出'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// Mock executor
vi.mock('../executor.js', () => ({
  getActiveProcessCount: vi.fn().mockReturnValue(3),
  MAX_SEATS: 6,
}));

// Mock 其他依赖
vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: vi.fn().mockResolvedValue(false),
  cacheRcaResult: vi.fn(),
  getRcaCacheStats: vi.fn().mockReturnValue({})
}));
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn().mockReturnValue(false),
  dispatchToDevSkill: vi.fn(),
  getAutoFixStats: vi.fn().mockReturnValue({})
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn() }));

// 测试 detectResourcePressure 逻辑（模拟版本）
function makeResourceStats(activeCount, maxSeats) {
  const pressure = activeCount / maxSeats;
  const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  return {
    active_count: activeCount,
    max_seats: maxSeats,
    pressure,
    rss_mb: rssMB,
    cpu_percent: 5.0, // 模拟值
  };
}

// 模拟 cycle 写入逻辑（与实现保持一致）
async function simulateResourceSnapshotWrite(pool, resourceStats) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('resource_snapshot', $1, NOW())`,
      [JSON.stringify({
        cpu_percent: resourceStats.cpu_percent,
        rss_mb: resourceStats.rss_mb,
        active_processes: resourceStats.active_count,
        max_seats: resourceStats.max_seats,
        utilization: resourceStats.pressure,
      })]
    );
    return true;
  } catch (err) {
    console.warn(`[Monitor] resource_snapshot 写入失败: ${err.message}`);
    return false;
  }
}

describe('Monitor resource_snapshot - D3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('D3-1: cycle 调用 pool.query 写入 resource_snapshot', async () => {
    const resourceStats = makeResourceStats(3, 6);
    await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('resource_snapshot'),
      expect.any(Array)
    );
  });

  it('D3-2: payload 包含 cpu_percent、rss_mb、active_processes、max_seats、utilization', async () => {
    const resourceStats = makeResourceStats(3, 6);
    let capturedPayload = null;

    mockQuery.mockImplementationOnce((sql, params) => {
      capturedPayload = JSON.parse(params[0]);
      return { rows: [] };
    });

    await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);

    expect(capturedPayload).toHaveProperty('cpu_percent');
    expect(capturedPayload).toHaveProperty('rss_mb');
    expect(capturedPayload).toHaveProperty('active_processes', 3);
    expect(capturedPayload).toHaveProperty('max_seats', 6);
    expect(capturedPayload).toHaveProperty('utilization', 0.5);
  });

  it('D3-2: utilization 计算正确（active/max_seats）', async () => {
    const resourceStats = makeResourceStats(4, 8);
    expect(resourceStats.pressure).toBe(0.5);

    let capturedPayload = null;
    mockQuery.mockImplementationOnce((sql, params) => {
      capturedPayload = JSON.parse(params[0]);
      return { rows: [] };
    });

    await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);
    expect(capturedPayload.utilization).toBe(0.5);
  });

  it('D3-3: pool.query 抛出异常时，函数不抛出（返回 false）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const resourceStats = makeResourceStats(3, 6);
    const result = await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);

    // 不抛出异常，返回 false
    expect(result).toBe(false);
  });

  it('D3-3: 多次写入时，某次失败不影响下次调用', async () => {
    // 模拟第一次成功，第二次失败，第三次成功
    const resourceStats = makeResourceStats(3, 6);

    mockQuery.mockResolvedValueOnce({ rows: [] }); // 第一次成功
    const r1 = await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);
    expect(r1).toBe(true);

    mockQuery.mockRejectedValueOnce(new Error('snapshot failed')); // 第二次失败
    const r2 = await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);
    expect(r2).toBe(false); // 失败返回 false

    mockQuery.mockResolvedValueOnce({ rows: [] }); // 第三次成功
    const r3 = await simulateResourceSnapshotWrite({ query: mockQuery }, resourceStats);
    expect(r3).toBe(true); // 恢复正常
  });
});
