/**
 * drain.js — Mock 单元测试 [BEHAVIOR]
 *
 * 与 src/__tests__/integration/tick-drain-persist.integration.test.js 互补：
 * 该文件用真实 DB 验证"跨重启持久化"确实生效；本文件用 mock query 验证
 * drainTick/restoreDrainState/cancelDrain/getDrainStatus 调用了正确的
 * working_memory 读写语句（快速反馈，不依赖 DB 环境）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('drain.js — working_memory 持久化', () => {
  let drainTick, restoreDrainState, cancelDrain, getDrainStatus, _getDrainState, _resetDrainState;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const mod = await import('../drain.js');
    drainTick = mod.drainTick;
    restoreDrainState = mod.restoreDrainState;
    cancelDrain = mod.cancelDrain;
    getDrainStatus = mod.getDrainStatus;
    _getDrainState = mod._getDrainState;
    _resetDrainState = mod._resetDrainState;
  });

  it('drainTick() 应把 draining 状态写入 working_memory（INSERT ... ON CONFLICT）', async () => {
    await drainTick();

    const writeCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO working_memory'));
    expect(writeCall).toBeTruthy();
    expect(writeCall[1][0]).toBe('tick_draining');
    expect(writeCall[1][1]).toMatchObject({ draining: true });
  });

  it('restoreDrainState() 读到新鲜 draining=true 记录时，应恢复内存态（过期残留见 drain-stale-restore.integration.test.js）', async () => {
    const freshStartedAt = new Date(Date.now() - 60 * 1000).toISOString();
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT value_json FROM working_memory')) {
        return Promise.resolve({
          rows: [{ value_json: { draining: true, drain_started_at: freshStartedAt } }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    expect(_getDrainState().draining).toBe(false);
    await restoreDrainState();
    expect(_getDrainState().draining).toBe(true);
  });

  it('restoreDrainState() 读到空记录时，不应把 draining 设为 true', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await restoreDrainState();
    expect(_getDrainState().draining).toBe(false);
  });

  it('cancelDrain() 应清除 working_memory 里的持久化记录（DELETE）', async () => {
    await drainTick();
    mockQuery.mockClear();

    await cancelDrain();

    const deleteCall = mockQuery.mock.calls.find(([sql]) => sql.includes('DELETE FROM working_memory'));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[1][0]).toBe('tick_draining');
  });

  it('getDrainStatus() auto-complete（无 in_progress 任务）时应清除持久化记录', async () => {
    await drainTick();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] }); // 无 in_progress 任务

    await getDrainStatus();

    const deleteCall = mockQuery.mock.calls.find(([sql]) => sql.includes('DELETE FROM working_memory'));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[1][0]).toBe('tick_draining');
    expect(_getDrainState().draining).toBe(false);
  });
});
