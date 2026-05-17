/**
 * Token Pressure Tests — getTokenPressure (executor.js)
 *
 * 覆盖 0/1/2/3 可用账号场景、即将重置、API 错误
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock account-usage before importing executor
vi.mock('../account-usage.js', () => ({
  getAccountUsage: vi.fn(() => Promise.resolve({})),
  selectBestAccount: vi.fn(),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn(() => Promise.resolve({ rows: [{ count: '0' }] })) },
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    default: {
      ...actual,
      cpus: () => Array(8).fill({ model: 'test', speed: 2400 }),
      totalmem: () => 16 * 1024 * 1024 * 1024,
      freemem: () => 8 * 1024 * 1024 * 1024,
      loadavg: () => [1.0, 1.0, 1.0],
    },
    cpus: () => Array(8).fill({ model: 'test', speed: 2400 }),
    totalmem: () => 16 * 1024 * 1024 * 1024,
    freemem: () => 8 * 1024 * 1024 * 1024,
    loadavg: () => [1.0, 1.0, 1.0],
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn((p) => {
      if (p === '/proc/stat') return 'cpu  100 0 100 800 0 0 0 0 0 0\n';
      if (p === '/proc/meminfo') return 'SwapTotal:       0 kB\nSwapFree:        0 kB\n';
      return actual.readFileSync(p);
    }),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  spawn: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: {},
  STATUS: {},
  EXECUTOR_HOSTS: {},
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    config: { executor: { model_map: {}, fixed_provider: 'anthropic' } },
  })),
  FALLBACK_PROFILE: {
    config: { executor: { model_map: {}, fixed_provider: 'anthropic' } },
  },
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'local'),
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import { getAccountUsage } from '../account-usage.js';
import { getTokenPressure, TOKEN_PRESSURE_THRESHOLD } from '../executor.js';

describe('getTokenPressure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回 threshold 常量 = 80', () => {
    expect(TOKEN_PRESSURE_THRESHOLD).toBe(80);
  });

  it('0 个可用账号 → token_pressure = 1.0', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 95, resets_at: null },
      account2: { five_hour_pct: 100, resets_at: null },
      account3: { five_hour_pct: 88, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.token_pressure).toBe(1.0);
    expect(result.available_accounts).toBe(0);
  });

  it('1 个可用账号 (5h < 80%) → token_pressure = 0.7', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 50, resets_at: null },
      account2: { five_hour_pct: 95, resets_at: null },
      account3: { five_hour_pct: 100, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.available_accounts).toBe(1);
    expect(result.token_pressure).toBe(0.7);
  });

  it('1 个可用账号 (5h > 72%) → token_pressure = 0.9', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 75, resets_at: null },
      account2: { five_hour_pct: 95, resets_at: null },
      account3: { five_hour_pct: 100, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.available_accounts).toBe(1);
    expect(result.token_pressure).toBe(0.9);
  });

  it('2 个可用账号 → token_pressure 在 0.1-0.5 之间', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 30, resets_at: null },
      account2: { five_hour_pct: 50, resets_at: null },
      account3: { five_hour_pct: 95, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.available_accounts).toBe(2);
    expect(result.token_pressure).toBeGreaterThanOrEqual(0.1);
    expect(result.token_pressure).toBeLessThanOrEqual(0.5);
  });

  it('3 个可用账号 → token_pressure 在 0.0-0.3 之间', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 10, resets_at: null },
      account2: { five_hour_pct: 20, resets_at: null },
      account3: { five_hour_pct: 30, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.available_accounts).toBe(3);
    expect(result.token_pressure).toBeGreaterThanOrEqual(0.0);
    expect(result.token_pressure).toBeLessThanOrEqual(0.3);
  });

  it('3 个账号全部 0% → token_pressure = 0.0', async () => {
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 0, resets_at: null },
      account2: { five_hour_pct: 0, resets_at: null },
      account3: { five_hour_pct: 0, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.token_pressure).toBe(0);
    expect(result.available_accounts).toBe(3);
  });

  it('账号即将重置 (30 分钟内) → 视为可用', async () => {
    const soonReset = new Date(Date.now() + 15 * 60000).toISOString();
    getAccountUsage.mockResolvedValue({
      account1: { five_hour_pct: 95, resets_at: soonReset },
      account2: { five_hour_pct: 95, resets_at: null },
      account3: { five_hour_pct: 95, resets_at: null },
    });

    const result = await getTokenPressure();
    expect(result.available_accounts).toBe(1);
    expect(result.token_pressure).toBeLessThan(1.0);
  });

  it('API 错误 → fallback 无压力', async () => {
    getAccountUsage.mockRejectedValue(new Error('API timeout'));

    const result = await getTokenPressure();
    expect(result.token_pressure).toBe(0);
    expect(result.available_accounts).toBe(3);
    expect(result.details).toContain('fallback');
  });

  it('空数据 → token_pressure = 1.0', async () => {
    getAccountUsage.mockResolvedValue({});

    const result = await getTokenPressure();
    expect(result.token_pressure).toBe(1.0);
    expect(result.available_accounts).toBe(0);
  });
});
