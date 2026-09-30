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

describe('drain.js — 运行期超龄自愈（09-29 部署后 drain-cancel 失败，派发停摆）', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('isDraining()：排空超过 DRAIN_RESTORE_MAX_AGE_MS → 自动解除并清持久化行，派发恢复', async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const mod = await import('../drain.js');
    vi.useFakeTimers({ now: new Date('2026-09-29T03:13:19.000Z') });
    await mod.drainTick();
    expect(mod.isDraining()).toBe(true);
    mockQuery.mockClear();

    vi.setSystemTime(new Date(Date.parse('2026-09-29T03:13:19.000Z') + mod.DRAIN_RESTORE_MAX_AGE_MS + 1000));
    expect(mod.isDraining(), '超龄排空仍在拦派发——一次部署就能让产线永久停摆').toBe(false);
    await Promise.resolve();
    const del = mockQuery.mock.calls.find(([sql]) => sql.includes('DELETE FROM working_memory'));
    expect(del, '超龄解除必须同步清库，否则下次重启又被恢复').toBeTruthy();
    expect(mod._getDrainState().draining).toBe(false);
    vi.useRealTimers();
  });

  it('isDraining()：未超龄的正常排空（部署 pre-swap 等待期）保持生效', async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const mod = await import('../drain.js');
    vi.useFakeTimers({ now: new Date('2026-09-29T03:13:19.000Z') });
    await mod.drainTick();
    vi.setSystemTime(new Date(Date.parse('2026-09-29T03:13:19.000Z') + 5 * 60 * 1000));
    expect(mod.isDraining()).toBe(true);
    vi.useRealTimers();
  });
});

describe('drain.js — 部署竞态（cancel-before-restore，任务 30861749）', () => {
  it('cancelDrain() 在 restoreDrainState() 之前被调用时，必须让 restoreDrainState() 之后不再恢复排空', async () => {
    vi.resetModules();
    mockQuery.mockReset();

    // 有状态的假 working_memory 表：INSERT/DELETE 真正改变后续 SELECT 的返回值，
    // 而不是硬编码固定返回旧数据——否则测不出 cancelDrain() 到底有没有真清库。
    let fakeRow = null;
    mockQuery.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO working_memory')) {
        fakeRow = { value_json: params[1] };
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('DELETE FROM working_memory')) {
        fakeRow = null;
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT value_json FROM working_memory')) {
        return Promise.resolve({ rows: fakeRow ? [fakeRow] : [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const mod = await import('../drain.js');

    // 模拟旧容器：正常进入排空并持久化到 working_memory（真的写进 fakeRow）
    await mod.drainTick();
    expect(fakeRow, '前置条件：drainTick 后应该已持久化').not.toBeNull();

    // 模拟新容器：进程重启，内存态归零，但 DB 里持久化行还在（fakeRow 不变）
    mod._resetDrainState();

    // 模拟部署脚本健康检查通过后立刻发来的 drain-cancel —— 此时 restoreDrainState() 还没跑，
    // 新容器内存里 _draining 仍是 false。
    expect(mod._getDrainState().draining, '新容器启动瞬间 _draining 应为 false').toBe(false);
    await mod.cancelDrain();
    expect(fakeRow, 'cancelDrain() 必须真正清掉持久化行（哪怕调用时 _draining 还是 false）').toBeNull();

    // 随后启动链才跑到 restoreDrainState()（tick-recovery.js initTickLoop 尾部）
    await mod.restoreDrainState();

    expect(
      mod.isDraining(),
      'cancelDrain 在 restore 之前发生时，之后的 restore 不应该把已经取消的排空重新恢复——' +
        '否则复现任务 30861749：部署健康检查通过后派单仍卡 15 分钟'
    ).toBe(false);
  });
});
