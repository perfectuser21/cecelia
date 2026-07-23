/**
 * account-usage.js — auth 熔断自愈（来源无关化）单元测试
 *
 * 血统（issue 5167ef48 / task fb8fae07）：markAuthFailure 内存条目带 source，但
 * account_usage_cache 表不存 source → Brain 重启后 loadAuthFailuresFromDB 恢复的
 * 熔断丢 source → proactiveTokenCheck 只清 source==='token_expired' 的熔断 →
 * token 已刷新（usage API 实测 200）仍被隔离最长 24h。2026-07-23 害 P0 任务
 * 143f66e1 四个 relay 容器 "Not logged in" 连退终态。
 *
 * 合同（来源无关自愈）：usage API 对某账号实测成功（HTTP 200 JSON）= 凭据被证明
 * 有效 → 清除该账号任何来源/无来源的 auth 熔断 + 重置退避计数；
 * 401/403/429/网络错误 → 不清除。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool, mockReadFileSync } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const mockReadFileSync = vi.fn();
  return { mockPool, mockReadFileSync };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/alert-debounce.js', () => ({
  resetDebounce: vi.fn(),
  shouldFire: vi.fn(),
  _debounceStatus: vi.fn(() => ({ entries: 0 })),
}));

import {
  getAccountUsage,
  loadAuthFailuresFromDB,
  markAuthFailure,
  isAuthFailed,
} from '../account-usage.js';

const FUTURE = () => new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
const USAGE_OK = {
  five_hour: { utilization: 3, resets_at: null },
  seven_day: { utilization: 17, resets_at: null },
  seven_day_sonnet: { utilization: 0, resets_at: null },
};

function purgeBreakers() {
  const past = new Date(Date.now() - 1000).toISOString();
  for (const id of ['account1', 'account2', 'account3']) {
    markAuthFailure(id, past);
    isAuthFailed(id); // 过期自动清理
  }
}

let origFetch;

beforeEach(() => {
  purgeBreakers();
  vi.clearAllMocks();
  mockPool.query.mockResolvedValue({ rows: [] });
  // 凭据文件有效（token 存在，未过期）
  mockReadFileSync.mockReturnValue(JSON.stringify({
    claudeAiOauth: { accessToken: 'tok-valid', expiresAt: Date.now() + 3600_000 },
  }));
  origFetch = global.fetch;
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = origFetch;
  purgeBreakers();
});

describe('auth 熔断自愈（来源无关化，issue 5167ef48）', () => {
  it('重启恢复（DB 行无 source）的熔断：usage API 200 后必须清除（143f66e1 复现面）', async () => {
    // 模拟 Brain 重启：从 DB 恢复熔断（source 天然丢失）
    mockPool.query.mockResolvedValueOnce({
      rows: [{ account_id: 'account1', auth_fail_resets_at: FUTURE(), auth_fail_count: 1 }],
    });
    await loadAuthFailuresFromDB();
    expect(isAuthFailed('account1')).toBe(true);

    // usage API 实测 200 = 凭据有效
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => USAGE_OK });
    mockPool.query.mockResolvedValue({ rows: [] });
    await getAccountUsage(true, ['account1']);

    expect(isAuthFailed('account1')).toBe(false);
  });

  it('source=api_error 的熔断：usage API 200 后同样清除（来源无关）', async () => {
    markAuthFailure('account1', FUTURE(), 'api_error');
    expect(isAuthFailed('account1')).toBe(true);

    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => USAGE_OK });
    await getAccountUsage(true, ['account1']);

    expect(isAuthFailed('account1')).toBe(false);
  });

  it('usage API 401 → 熔断不清除', async () => {
    markAuthFailure('account1', FUTURE(), 'api_error');
    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    await getAccountUsage(true, ['account1']);
    expect(isAuthFailed('account1')).toBe(true);
  });

  it('usage API 429 → 熔断不清除（限流≠凭据有效证明）', async () => {
    markAuthFailure('account1', FUTURE(), 'api_error');
    global.fetch.mockResolvedValue({ ok: false, status: 429 });
    await getAccountUsage(true, ['account1']);
    expect(isAuthFailed('account1')).toBe(true);
  });

  it('网络错误 → 熔断不清除', async () => {
    markAuthFailure('account1', FUTURE(), 'api_error');
    global.fetch.mockRejectedValue(new Error('network down'));
    await getAccountUsage(true, ['account1']);
    expect(isAuthFailed('account1')).toBe(true);
  });

  it('清除动作同步落 DB（is_auth_failed=false）', async () => {
    markAuthFailure('account1', FUTURE(), 'api_error');
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => USAGE_OK });
    await getAccountUsage(true, ['account1']);

    const clearCalls = mockPool.query.mock.calls.filter(([sql]) =>
      /is_auth_failed\s*=\s*false/i.test(sql));
    expect(clearCalls.length).toBeGreaterThan(0);
  });
});
