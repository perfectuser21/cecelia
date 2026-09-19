// ops-model-accounts-collector.test.js — 采集器纯函数单测（brain-unit 无 DB 段）
//
// 配对 lint（lint-test-pairing）要求新增 packages/brain/src 源文件配套 *.test.js。
// 本单测只覆盖无 DB 依赖的纯函数（三家 parser 归一 schema + Grok 过期分类 + 静态注册表 +
// status 枚举单份）；collector→表→端点的真 PG 写/读路径由冻结合同 [integration] 段
// （sprints/09190907-model-account-quota-projection/tests/model-accounts.test.ts）在
// harness Sprint Tests / brain-integration 真 Postgres 下承担，不在此重复。
import { describe, it, expect } from 'vitest';
import {
  MODEL_ACCOUNT_STATUS,
  MODEL_ACCOUNTS,
  parseAnthropicUsage,
  parseChatgptWhamUsage,
  parseGrokUsage,
  classifyGrokUsageError,
} from '../ops-model-accounts-collector.js';

const SNAPSHOT_KEYS = ['five_hour_pct', 'seven_day_pct', 'reset_at'];

describe('ops-model-accounts-collector 纯函数', () => {
  it('status 四态枚举齐全（ok|unknown|key_expired|no_credential）', () => {
    expect([...MODEL_ACCOUNT_STATUS].sort()).toEqual(
      ['key_expired', 'no_credential', 'ok', 'unknown'].sort(),
    );
  });

  it('静态注册表恰好 8 个账号，account_id 各唯一，凭据全在 mmv', () => {
    expect(MODEL_ACCOUNTS).toHaveLength(8);
    expect(new Set(MODEL_ACCOUNTS.map((a) => a.account_id)).size).toBe(8);
    expect(MODEL_ACCOUNTS.every((a) => a.host_alias === 'mmv')).toBe(true);
  });

  it('forwardable/forward_targets 静态：Codex 可转发 / Grok 锁本机', () => {
    const codex = MODEL_ACCOUNTS.find((a) => /codex/i.test(a.provider));
    expect(codex.forwardable).toBe(true);
    expect(codex.forward_targets).toEqual(expect.arrayContaining(['xian-m4', 'xian-m1']));
    const grok = MODEL_ACCOUNTS.find((a) => /grok/i.test(a.provider));
    expect(grok.forwardable).toBe(false);
    expect(grok.forward_targets).toEqual([]);
  });

  it('三家 parser 归一同一 schema', () => {
    const a = parseAnthropicUsage({ five_hour: { utilization: 42, resets_at: '2026-09-19T10:00:00Z' }, seven_day: { utilization: 71 } });
    expect(Object.keys(a).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(a.five_hour_pct).toBe(42);
    expect(a.seven_day_pct).toBe(71);

    const c = parseChatgptWhamUsage({ five_hour: { usage_percent: 12 }, seven_day: { usage_percent: 88 } });
    expect(c.five_hour_pct).toBe(12);
    expect(c.seven_day_pct).toBe(88);

    const g = parseGrokUsage({ five_hour_pct: 5, seven_day_pct: 9, reset_at: null });
    expect(g.five_hour_pct).toBe(5);
  });

  it('parser 遇结构缺失不抛，缺字段 → null（诚实留空，不编造 0）', () => {
    const out = parseAnthropicUsage({});
    expect(out.five_hour_pct).toBeNull();
    expect(out.seven_day_pct).toBeNull();
  });

  it('classifyGrokUsageError：grpc-status 7 / PERMISSION_DENIED → key_expired，其余 → unknown', () => {
    expect(classifyGrokUsageError({ grpcStatus: 7, message: 'PERMISSION_DENIED' })).toBe('key_expired');
    expect(classifyGrokUsageError({ message: 'grpc-status: 7' })).toBe('key_expired');
    expect(classifyGrokUsageError({ message: 'connection timeout' })).toBe('unknown');
  });
});
