// ops-quota-notion.test.js — 刀2 Notion 收尾：配额列补列 + 按 provider 选账号 + 属性构造
//
// PRD 第 4 步（判定点：并入现有 Agents&机器 库加列）在 #5411 只落了列定义：
// 既有「Ops Agent 图谱」库没有 FiveHourPct/SevenDayPct/QuotaUpdatedAt，push 也不填值。
// 这里锁三件事：缺列即补只发缺的；agent 行按模型 provider 取该 provider 最紧张账号；属性不编造 0。
import { describe, it, expect, vi } from 'vitest';
import {
  inferProviderFromModelId,
  pickProviderQuota,
  buildQuotaProps,
  ensureOpsDbProps,
} from '../ops-quota-notion.js';

const accounts = [
  { account_id: 'claude-account1', provider: 'claude', status: 'ok', five_hour_pct: 0, seven_day_pct: 24, last_checked_at: '2026-09-19T10:00:00Z' },
  { account_id: 'claude-account2', provider: 'claude', status: 'ok', five_hour_pct: 19, seven_day_pct: 42, last_checked_at: '2026-09-19T10:00:01Z' },
  { account_id: 'codex-team1', provider: 'codex', status: 'ok', five_hour_pct: null, seven_day_pct: 2, last_checked_at: '2026-09-19T10:00:02Z' },
  { account_id: 'codex-team3', provider: 'codex', status: 'ok', five_hour_pct: 24, seven_day_pct: 56, last_checked_at: '2026-09-19T10:00:03Z' },
  { account_id: 'grok', provider: 'grok', status: 'key_expired', five_hour_pct: null, seven_day_pct: null, last_checked_at: '2026-09-19T10:00:04Z' },
];

describe('inferProviderFromModelId', () => {
  it('openclaw 分身的 model id 前缀 → provider', () => {
    expect(inferProviderFromModelId('openai/gpt-5.6-terra')).toBe('codex');
    expect(inferProviderFromModelId('anthropic/claude-sonnet-5')).toBe('claude');
    expect(inferProviderFromModelId('xai/grok-4.5')).toBe('grok');
    expect(inferProviderFromModelId('claude-opus-5')).toBe('claude');
  });
  it('未知/空 → null（不猜）', () => {
    expect(inferProviderFromModelId(null)).toBeNull();
    expect(inferProviderFromModelId('deepseek/deepseek-v4')).toBeNull();
  });
});

describe('pickProviderQuota', () => {
  it('同 provider 取 seven_day_pct 最大者（最紧张的那份），只看 status=ok', () => {
    expect(pickProviderQuota(accounts, 'claude')).toMatchObject({ account_id: 'claude-account2', seven_day_pct: 42, five_hour_pct: 19 });
    expect(pickProviderQuota(accounts, 'codex')).toMatchObject({ account_id: 'codex-team3', seven_day_pct: 56 });
  });
  it('provider 无 ok 账号（grok 全 key_expired）或 provider 为空 → null', () => {
    expect(pickProviderQuota(accounts, 'grok')).toBeNull();
    expect(pickProviderQuota(accounts, null)).toBeNull();
    expect(pickProviderQuota([], 'claude')).toBeNull();
  });
});

describe('buildQuotaProps', () => {
  it('有值才发，null 不发（禁编造 0）', () => {
    const p = buildQuotaProps({ five_hour_pct: null, seven_day_pct: 2, last_checked_at: '2026-09-19T10:00:02Z' });
    expect(p).toEqual({
      SevenDayPct: { number: 2 },
      QuotaUpdatedAt: { date: { start: '2026-09-19T10:00:02.000Z' } },
    });
    expect(buildQuotaProps(null)).toEqual({});
  });
});

describe('ensureOpsDbProps — 缺列即补（幂等）', () => {
  it('GET 库属性 → 只 PATCH 缺的列；全有则不 PATCH', async () => {
    const calls = [];
    const notionReq = vi.fn(async (token, path, method, body) => {
      calls.push({ path, method, body });
      if (method === 'GET') return { properties: { Name: { title: {} }, FiveHourPct: { number: {} } } };
      return { ok: true };
    });
    const wanted = { Name: { title: {} }, FiveHourPct: { number: {} }, SevenDayPct: { number: {} }, QuotaUpdatedAt: { date: {} } };
    const r = await ensureOpsDbProps('tok', 'db-1', wanted, { notionReq });
    expect(r.added.sort()).toEqual(['QuotaUpdatedAt', 'SevenDayPct']);
    expect(calls[0]).toMatchObject({ path: '/databases/db-1', method: 'GET' });
    expect(calls[1]).toMatchObject({ path: '/databases/db-1', method: 'PATCH', body: { properties: { SevenDayPct: { number: {} }, QuotaUpdatedAt: { date: {} } } } });

    calls.length = 0;
    const full = vi.fn(async () => ({ properties: wanted }));
    const r2 = await ensureOpsDbProps('tok', 'db-1', wanted, { notionReq: full });
    expect(r2.added).toEqual([]);
    expect(full).toHaveBeenCalledTimes(1);
  });
});
