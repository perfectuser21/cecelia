/**
 * blocking-states.test.js — 阻断类状态位 TTL 自愈 + 可见性（mock 单元）[BEHAVIOR]
 *
 * 配套 src/blocking-states.js（lint-test-pairing 精确名匹配）。
 * 真 Postgres 端到端见 src/__tests__/integration/blocking-states-selfheal.integration.test.js。
 *
 * PRD: sprints/08111700-blocking-state-ttl-selfheal —— 终结「健康地停摆」。
 * 事故实证：2026-08-10 tick_draining 卡 2h20m（5 条 P0 零派发、健康检查报 healthy）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const drainMock = vi.hoisted(() => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
  cancelDrain: vi.fn(async () => ({ success: true, was_draining: true })),
}));
const emitMock = vi.hoisted(() => vi.fn(async () => {}));
const raiseMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../drain.js', () => drainMock);
vi.mock('../event-bus.js', () => ({ emit: emitMock }));
vi.mock('../alerting.js', () => ({ raise: raiseMock }));

// mock pool：按 working_memory key 返回预置行；DELETE 记录调用
function poolReturning(map) {
  return {
    query: vi.fn(async (sql, params) => {
      const key = params?.[0];
      if (/SELECT value_json FROM working_memory/.test(sql)) {
        return { rows: map[key] ? [{ value_json: map[key] }] : [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;

let getBlockingStates, selfHealBlockingStates, DRAINING_TTL_MS;

beforeEach(async () => {
  vi.resetModules();
  drainMock.isDraining.mockReset().mockReturnValue(false);
  drainMock.getDrainStartedAt.mockReset().mockReturnValue(null);
  drainMock.cancelDrain.mockReset().mockResolvedValue({ success: true, was_draining: true });
  emitMock.mockReset().mockResolvedValue(undefined);
  raiseMock.mockReset().mockResolvedValue(undefined);
  const mod = await import('../blocking-states.js');
  getBlockingStates = mod.getBlockingStates;
  selfHealBlockingStates = mod.selfHealBlockingStates;
  DRAINING_TTL_MS = mod.DRAINING_TTL_MS;
});

describe('getBlockingStates — 阻断位可见性', () => {
  it('working_memory 有 tick_draining → 返回该阻断位 + 持续时长', async () => {
    const pool = poolReturning({ tick_draining: { draining: true, drain_started_at: iso(10 * MIN) } });
    const states = await getBlockingStates(pool);
    const drain = states.find((s) => s.key === 'tick_draining');
    expect(drain).toBeTruthy();
    expect(drain.duration_ms).toBeGreaterThan(9 * MIN);
    expect(typeof drain.since).toBe('string');
  });

  it('内存态 isDraining()=true（working_memory 缺）也算活跃阻断位', async () => {
    drainMock.isDraining.mockReturnValue(true);
    drainMock.getDrainStartedAt.mockReturnValue(iso(3 * MIN));
    const pool = poolReturning({});
    const states = await getBlockingStates(pool);
    expect(states.map((s) => s.key)).toContain('tick_draining');
  });

  it('machine_vitals_stale_alert 存在 → 作为阻断位返回（含 last_error 明细）', async () => {
    const pool = poolReturning({
      machine_vitals_stale_alert: { since: iso(120 * MIN), last_error: 'spawn docker ENOENT' },
    });
    const states = await getBlockingStates(pool);
    const v = states.find((s) => s.key === 'machine_vitals_stale_alert');
    expect(v).toBeTruthy();
    expect(v.duration_ms).toBeGreaterThan(60 * MIN);
    expect(v.detail).toMatch(/docker/);
  });

  it('已恢复标记（recovered_at）的哨兵不算活跃阻断位', async () => {
    const pool = poolReturning({
      machine_vitals_stale_alert: { recovered_at: iso(1 * MIN) },
    });
    const states = await getBlockingStates(pool);
    expect(states.find((s) => s.key === 'machine_vitals_stale_alert')).toBeFalsy();
  });

  it('无任何阻断位 → 返回空数组', async () => {
    const pool = poolReturning({});
    expect(await getBlockingStates(pool)).toEqual([]);
  });
});

describe('selfHealBlockingStates — tick_draining TTL 自愈', () => {
  it('drain 置位超过 TTL（31min > 30min）→ 自动解除 + 留痕事件 + 告警', async () => {
    drainMock.isDraining.mockReturnValue(true);
    drainMock.getDrainStartedAt.mockReturnValue(iso(31 * MIN));
    const pool = poolReturning({ tick_draining: { draining: true, drain_started_at: iso(31 * MIN) } });

    const res = await selfHealBlockingStates(pool, { ttlMs: 30 * MIN });

    expect(res.recovered.map((r) => r.key)).toContain('tick_draining');
    expect(drainMock.cancelDrain).toHaveBeenCalled();
    // 留痕：auto_recovered 事件
    expect(emitMock).toHaveBeenCalledWith(
      'blocking_state_auto_recovered',
      'blocking-states',
      expect.objectContaining({ key: 'tick_draining' }),
    );
    // 告警：禁止静默自愈
    expect(raiseMock).toHaveBeenCalled();
    // 兜底删残留行
    const del = pool.query.mock.calls.find(
      ([sql, params]) => /DELETE FROM working_memory/.test(sql) && params?.[0] === 'tick_draining',
    );
    expect(del).toBeTruthy();
  });

  it('drain 置位未超 TTL（5min < 30min）→ 不误伤，状态位仍在', async () => {
    drainMock.isDraining.mockReturnValue(true);
    drainMock.getDrainStartedAt.mockReturnValue(iso(5 * MIN));
    const pool = poolReturning({ tick_draining: { draining: true, drain_started_at: iso(5 * MIN) } });

    const res = await selfHealBlockingStates(pool, { ttlMs: 30 * MIN });

    expect(res.recovered).toEqual([]);
    expect(drainMock.cancelDrain).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('未 draining → 无动作', async () => {
    drainMock.isDraining.mockReturnValue(false);
    const pool = poolReturning({});
    const res = await selfHealBlockingStates(pool, { ttlMs: 30 * MIN });
    expect(res.recovered).toEqual([]);
    expect(drainMock.cancelDrain).not.toHaveBeenCalled();
  });
});

describe('DRAINING_TTL_MS — 默认值与环境变量覆盖', () => {
  it('默认 30 分钟', () => {
    expect(DRAINING_TTL_MS).toBe(30 * MIN);
  });

  it('TICK_DRAINING_TTL_MS 可覆盖', async () => {
    vi.resetModules();
    vi.stubEnv('TICK_DRAINING_TTL_MS', '1000');
    const mod = await import('../blocking-states.js');
    expect(mod.DRAINING_TTL_MS).toBe(1000);
    vi.unstubAllEnvs();
  });
});
