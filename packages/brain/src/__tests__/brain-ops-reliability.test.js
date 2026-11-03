import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const boundary = vi.hoisted(() => ({ query: vi.fn(), readFile: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('fs', async importOriginal => ({
  ...await importOriginal(), readFileSync: boundary.readFile,
}));
vi.mock('os', async importOriginal => ({
  ...await importOriginal(), homedir: () => '/isolated-brain-account-fixture',
}));
import { selectBestAccount } from '../account-usage.js';

// 只隔离凭据文件和数据库；账号排序、配额判断及会话过滤均执行生产选择器。
// 4h 是这些用例显式指定的输入，不代表生产调用方的默认策略。
describe('brain-ops-reliability — 真实账号选择', () => {
  let usage;
  let remaining;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止外部请求'); }));
    usage = { account1: 10, account2: 20 };
    remaining = { account1: 300, account2: 300 };
    boundary.readFile.mockImplementation(path => {
      const match = /^\/isolated-brain-account-fixture\/\.claude-(account[12])\/\.credentials\.json$/.exec(path);
      if (!match) throw new Error('测试禁止读取真实凭据');
      const minutes = remaining[match[1]];
      return JSON.stringify({ claudeAiOauth: {
        ...(minutes === null ? {} : { expiresAt: Date.now() + minutes * 60000 }),
      } });
    });
    boundary.query.mockReset().mockImplementation(async (sql, params) => {
      expect(sql).toContain('SELECT * FROM account_usage_cache');
      expect(sql).toContain("INTERVAL '3 minutes'");
      const id = params[0];
      expect(id).toMatch(/^account[12]$/);
      return { rows: [{ account_id: id, five_hour_pct: usage[id], seven_day_pct: 20,
        seven_day_sonnet_pct: 20, seven_day_omelette_pct: 0, extra_used: false,
        resets_at: '2026-01-01T05:00:00Z', seven_day_resets_at: null,
        seven_day_sonnet_resets_at: null, seven_day_omelette_resets_at: null,
        fetched_at: '2026-01-01T00:00:00Z' }] };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('健康账号按用量选出 account1 与真实模型', async () => {
    expect(await selectBestAccount({ minSessionHours: 4 })).toEqual({
      accountId: 'account1', model: 'sonnet', modelId: 'claude-sonnet-4-6',
    });
  });
  it('account1 达到5小时配额阈值后选 account2', async () => {
    usage.account1 = 80;
    expect((await selectBestAccount({ minSessionHours: 4 }))?.accountId).toBe('account2');
  });
  it('明确要求4小时：恰好4小时可选，少1分钟的低用量账号被排除', async () => {
    usage = { account1: 20, account2: 10 };
    remaining = { account1: 240, account2: 239 };
    expect((await selectBestAccount({ minSessionHours: 4 }))?.accountId).toBe('account1');
  });
  it('明确要求4小时且所有账号不足时返回 null', async () => {
    remaining = { account1: 60, account2: 120 };
    expect(await selectBestAccount({ minSessionHours: 4 })).toBeNull();
  });
  it('低用量 account1 只剩1小时，显式过滤后选 account2', async () => {
    remaining.account1 = 60;
    expect((await selectBestAccount({ minSessionHours: 4 }))?.accountId).toBe('account2');
  });
  it('不传 minSessionHours 时1小时账号仍参与正常排序', async () => {
    remaining.account1 = 60;
    expect((await selectBestAccount())?.accountId).toBe('account1');
  });
  it('没有 expiresAt 的账号不被会话时长过滤', async () => {
    remaining.account1 = null;
    expect((await selectBestAccount({ minSessionHours: 4 }))?.accountId).toBe('account1');
  });
});

describe('brain-keepalive-check.sh — shell 文件存在', () => {
  it('脚本文件存在且可执行', async () => {
    const { accessSync, constants } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/brain-keepalive-check.sh', import.meta.url).pathname,
      constants.X_OK
    );
  });

  it('plist 文件存在', async () => {
    const { accessSync } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/com.cecelia.brain-keepalive.plist', import.meta.url).pathname
    );
  });
});
