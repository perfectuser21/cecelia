import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const io = vi.hoisted(() => ({
  db: vi.fn(async () => { throw Error('drift_state_canonical_db_forbidden'); }),
  exec: vi.fn(), network: vi.fn(), spawn: vi.fn(), bark: vi.fn(), raise: vi.fn(),
  mkdir: vi.fn(), open: vi.fn(() => 71), write: vi.fn(), close: vi.fn(),
}));
vi.mock('../../db.js', () => ({ default: { query: io.db } }));
vi.mock('../../notifier.js', () => ({ sendBark: io.bark }));
vi.mock('../../alerting.js', () => ({ raise: io.raise }));
vi.mock('fs', () => ({
  mkdirSync: io.mkdir, openSync: io.open, writeSync: io.write, closeSync: io.close,
}));
vi.mock('child_process', () => ({
  exec: (...args) => { io.exec(...args); throw Error('drift_state_exec_forbidden'); },
  spawn: io.spawn,
}));

import { runDriftCheck, DRIFT_WINDOW_MS } from '../drift-sentinel.js';

const KEY = 'drift_sentinel_state';
const NOW = new Date('2026-10-01T00:00:00.000Z');
const MAIN = 'a'.repeat(40);
const PROD = 'b'.repeat(40);
const PAST = new Date(NOW.getTime() - DRIFT_WINDOW_MS - 1).toISOString();

// PostgreSQL jsonb 的行形态；只模拟I/O协议，不复制状态机。不存在的value列应报42703。
function makeDb(initial, { readFails = false, writeFails = false } = {}) {
  let stored = initial;
  const query = vi.fn(async (sql, params) => {
    expect(params?.[0]).toBe(KEY);
    if (/^SELECT\s+value\s+FROM/.test(sql)) {
      throw Object.assign(Error('synthetic column value does not exist'), { code: '42703' });
    }
    if (/^SELECT\s+value_json\s+FROM working_memory/.test(sql)) {
      if (readFails) throw Error('synthetic read unavailable');
      return { rows: stored === undefined ? [] : [{ value_json: structuredClone(stored) }] };
    }
    if (/^INSERT INTO working_memory \(key, value_json, updated_at\)/.test(sql)) {
      if (writeFails) throw Error('synthetic write unavailable');
      stored = JSON.parse(params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'DELETE FROM working_memory WHERE key = $1') {
      stored = undefined;
      return { rows: [], rowCount: 1 };
    }
    throw Error('unexpected synthetic DB protocol');
  });
  return { query, state: () => structuredClone(stored) };
}

function options(db, now = NOW) {
  return { db, now, fetchMainSha: vi.fn(async () => MAIN), fetchProdSha: vi.fn(async () => PROD) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  io.bark.mockResolvedValue(undefined);
  io.raise.mockResolvedValue(undefined);
  io.spawn.mockImplementation(() => ({ pid: 4242, unref: vi.fn(), on: vi.fn() }));
  vi.stubGlobal('fetch', (...args) => { io.network(...args); throw Error('drift_state_network_forbidden'); });
});
afterEach(() => {
  try {
    expect(io.db).not.toHaveBeenCalled();
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.network).not.toHaveBeenCalled();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe('drift sentinel 持久化状态真实读写接缝', () => {
  it('首见保存→窗口内保原时间→两次补部署→上限升级，状态跨真实调用恢复', async () => {
    const db = makeDb();
    expect((await runDriftCheck(options(db))).verdict).toBe('drifting');
    expect(db.state()).toEqual({ driftFirstSeenAt: NOW.toISOString(), redeployCount: 0, consecutiveNetworkErrors: 0 });
    const within = new Date(NOW.getTime() + DRIFT_WINDOW_MS - 1);
    expect((await runDriftCheck(options(db, within))).verdict).toBe('drifting');
    expect(db.state().driftFirstSeenAt).toBe(NOW.toISOString());
    expect(io.spawn).not.toHaveBeenCalled();
    const after = new Date(NOW.getTime() + DRIFT_WINDOW_MS + 1);
    const first = options(db, after);
    expect(await runDriftCheck(first)).toMatchObject({ verdict: 'redeploying', redeployCount: 1 });
    expect(first.fetchProdSha).toHaveBeenCalledTimes(2);
    expect(db.state().redeployCount).toBe(1);
    expect(await runDriftCheck(options(db, after))).toMatchObject({ verdict: 'redeploying', redeployCount: 2 });
    expect(db.state().redeployCount).toBe(2);
    expect((await runDriftCheck(options(db, after))).verdict).toBe('escalated');
    expect(io.spawn).toHaveBeenCalledTimes(2);
    expect(io.spawn).toHaveBeenCalledWith('bash', [expect.stringMatching(/\/scripts\/brain-deploy\.sh$/)],
      expect.objectContaining({ detached: true, stdio: ['ignore', 71, 71] }));
    expect(io.bark).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ dedupeKey: 'drift-escalated' }));
    expect(io.raise).toHaveBeenCalledWith('P1', 'drift_escalated', expect.any(String));
  });

  it('三轮network_error从JSONB恢复累计次数，第三轮才告警', async () => {
    const db = makeDb();
    for (let n = 1; n <= 3; n++) {
      const opts = options(db);
      opts.fetchMainSha.mockRejectedValue(Error('synthetic network failure'));
      expect((await runDriftCheck(opts)).verdict).toBe('network_error');
      expect(db.state().consecutiveNetworkErrors).toBe(n);
      expect(opts.fetchProdSha).not.toHaveBeenCalled();
      expect(io.bark).toHaveBeenCalledTimes(n === 3 ? 1 : 0);
    }
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it.each(['jsonb object', 'legacy JSON string'])('%s 保留已存重试上限及未知扩展字段', async (kind) => {
    const state = { driftFirstSeenAt: PAST, redeployCount: 2, consecutiveNetworkErrors: 1, futureMarker: 'retained' };
    const db = makeDb(kind === 'jsonb object' ? state : JSON.stringify(state));
    expect((await runDriftCheck(options(db))).verdict).toBe('escalated');
    expect(db.state()).toEqual({ ...state, consecutiveNetworkErrors: 0 });
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '{bad-json', 'null', 42, [], true])('无可用状态 %j 保留首次防抖降级，不触发部署', async (initial) => {
    const db = makeDb(initial);
    expect((await runDriftCheck(options(db))).verdict).toBe('drifting');
    expect(db.state()).toEqual({ driftFirstSeenAt: NOW.toISOString(), redeployCount: 0, consecutiveNetworkErrors: 0 });
    expect(io.spawn).not.toHaveBeenCalled();
    expect(io.bark).not.toHaveBeenCalled();
  });

  it('读失败保持既有首次防抖降级，不依据未知状态触发部署', async () => {
    const db = makeDb({ driftFirstSeenAt: PAST, redeployCount: 2 }, { readFails: true });
    expect((await runDriftCheck(options(db))).verdict).toBe('drifting');
    expect(io.spawn).not.toHaveBeenCalled();
    expect(io.bark).not.toHaveBeenCalled();
  });

  it('状态保存失败保持reject，不虚报已记状态或触发部署', async () => {
    const db = makeDb(undefined, { writeFails: true });
    await expect(runDriftCheck(options(db))).rejects.toThrow('synthetic write unavailable');
    expect(db.state()).toBeUndefined();
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it('一致SHA仍删除状态，不补部署', async () => {
    const db = makeDb({ driftFirstSeenAt: PAST, redeployCount: 2 });
    const opts = options(db);
    opts.fetchProdSha.mockResolvedValue(MAIN);
    expect((await runDriftCheck(opts)).verdict).toBe('ok');
    expect(db.state()).toBeUndefined();
    expect(db.query).toHaveBeenCalledWith('DELETE FROM working_memory WHERE key = $1', [KEY]);
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it('生产SHA未知保留漂移时间/重试次数，仅清网络失败计数', async () => {
    const db = makeDb({ driftFirstSeenAt: PAST, redeployCount: 1, consecutiveNetworkErrors: 2 });
    const opts = options(db);
    opts.fetchProdSha.mockRejectedValue(Error('synthetic unavailable'));
    expect((await runDriftCheck(opts)).verdict).toBe('prod_unreachable');
    expect(db.state()).toEqual({ driftFirstSeenAt: PAST, redeployCount: 1, consecutiveNetworkErrors: 0 });
    expect(io.spawn).not.toHaveBeenCalled();
  });
});
