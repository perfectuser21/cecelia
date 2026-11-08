import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = vi.hoisted(() => ({
  home: '', read: vi.fn(), query: vi.fn(), raise: vi.fn(), reset: vi.fn(), forbidden: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('os', async original => ({ ...await original(), homedir: () => boundary.home }));
vi.mock('fs', async original => {
  const real = await original();
  return { ...real, readFileSync: (...args) => {
    const allowed = ['account1', 'account2'].map(id => `${boundary.home}/.claude-${id}/.credentials.json`);
    if (!boundary.home || !allowed.includes(String(args[0]))) {
      boundary.forbidden('credentials-path');
      throw Error('禁止读取非owned凭据');
    }
    boundary.read(...args);
    return real.readFileSync(...args);
  } };
});
vi.mock('../alerting.js', () => ({ raise: boundary.raise }));
vi.mock('../lib/alert-debounce.js', () => ({ resetDebounce: boundary.reset }));
import { proactiveTokenCheck, markAuthFailure, isAuthFailed, _resetAuthFailures } from '../account-usage.js';

const NOW = new Date('2026-11-05T00:00:00Z');
const future = NOW.getTime() + 2 * 60 * 60 * 1000;
function writeCredentials(account, text) {
  writeFileSync(join(boundary.home, `.claude-${account}`, '.credentials.json'), text);
}
function valid(expiresAt = future) {
  return JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-only-token', expiresAt } });
}
function trip(source = 'token_expired') {
  markAuthFailure('account1', new Date(future).toISOString(), source);
  expect(isAuthFailed('account1')).toBe(true);
  boundary.query.mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  _resetAuthFailures();
  vi.clearAllMocks();
  boundary.query.mockResolvedValue({ rows: [] });
  boundary.raise.mockResolvedValue(undefined);
  boundary.home = mkdtempSync(join(tmpdir(), 'token-expiry-owned-'));
  for (const account of ['account1', 'account2']) {
    mkdirSync(join(boundary.home, `.claude-${account}`));
    writeCredentials(account, valid());
  }
  vi.stubGlobal('fetch', (...args) => {
    boundary.forbidden('fetch');
    throw Error('禁止真实网络');
  });
});
afterEach(() => {
  expect(boundary.forbidden).not.toHaveBeenCalled();
  rmSync(boundary.home, { recursive: true, force: true });
  boundary.home = '';
  _resetAuthFailures();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('未知到期不能被当作凭据恢复', () => {
  it.each([
    ['缺文件', undefined], ['坏JSON', '{'], ['JSON null', 'null'],
    ['无OAuth', '{}'], ['无expiresAt', '{"claudeAiOauth":{}}'],
    ['null到期', '{"claudeAiOauth":{"expiresAt":null}}'],
    ['坏字符串到期', '{"claudeAiOauth":{"expiresAt":"unknown"}}'],
    ['数组到期', '{"claudeAiOauth":{"expiresAt":[]}}'],
    ['对象到期', '{"claudeAiOauth":{"expiresAt":{}}}'],
    ['布尔到期', '{"claudeAiOauth":{"expiresAt":true}}'],
    ['指数溢出', '{"claudeAiOauth":{"expiresAt":1e400}}'],
  ])('%s保留token_expired熔断与退避，不写恢复SQL', async (_, contents) => {
    if (contents === undefined) rmSync(join(boundary.home, '.claude-account1', '.credentials.json'));
    else writeCredentials('account1', contents);
    trip();
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(true);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.reset).not.toHaveBeenCalledWith('token_expiring_soon_account1');
    expect(boundary.raise).not.toHaveBeenCalled();
  });

  it('未知不会清零已有退避次数', async () => {
    writeCredentials('account1', '{}');
    trip();
    await proactiveTokenCheck();
    markAuthFailure('account1');
    expect(boundary.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO account_usage_cache'),
      ['account1', new Date(NOW.getTime() + 4 * 60 * 60 * 1000).toISOString(), 2]);
  });

  it('已知有效新凭据仍清除token_expired熔断与计数', async () => {
    trip();
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(false);
    expect(boundary.query).toHaveBeenCalledWith(expect.stringContaining('is_auth_failed = false'), ['account1']);
    expect(boundary.query).toHaveBeenCalledWith(expect.stringContaining('auth_fail_count = 0'), ['account1']);
    expect(boundary.reset).toHaveBeenCalledWith('token_expiring_soon_account1');
  });

  it('已知有效文件不清API 401来源熔断', async () => {
    trip('api_error');
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(true);
    expect(boundary.query).not.toHaveBeenCalled();
  });

  it('无已有熔断时未知不凭空新增熔断或通知', async () => {
    writeCredentials('account1', '{}');
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(false);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.raise).not.toHaveBeenCalled();
  });
});

describe('到期元数据形态与已过期边界', () => {
  it.each(['[]', '{}', 'true', 'null', '"unknown"', '1e400'])('非法到期%s不凭空新增熔断', async value => {
    writeCredentials('account1', `{"claudeAiOauth":{"expiresAt":${value}}}`);
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(false);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.raise).not.toHaveBeenCalled();
  });

  it.each([0, NOW.getTime() - 1])('有限且已过期时间%s仍触发原熔断与告警', async expiresAt => {
    writeCredentials('account1', valid(expiresAt));
    await proactiveTokenCheck();
    expect(isAuthFailed('account1')).toBe(true);
    expect(boundary.raise).toHaveBeenCalledWith('P1', 'token_expired_account1', expect.stringContaining('account1'));
    expect(boundary.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO account_usage_cache'),
      ['account1', new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(), 1]);
  });
});
