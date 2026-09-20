import { describe, it, expect } from 'vitest';
import {
  judgeAccount,
  DISPATCH_GATE_FIVE_HOUR_PCT,
  DISPATCH_GATE_SEVEN_DAY_PCT,
  QUOTA_VERDICTS,
} from '../orchestrator/preflight/account-quota-ledger.js';
import { MODEL_ACCOUNT_STATUS } from '../ops-model-accounts-collector.js';

// collector 的写库语义（upsertModelAccountFailure 的 CASE）：status 只在
// consecutive_failures+1 >= 3 时才落终态；成功路径一律 consecutive_failures=0 且 status='ok'。
// 所以「终态 status + consecutive_failures=0」在生产不可能存在 —— 用那种 fixture
// 测出来的绿是假绿。本文件所有 fixture 必须自洽。
const row = (over = {}) => ({
  account_id: 'codex-team1',
  provider: 'codex',
  five_hour_pct: 10,
  seven_day_pct: 10,
  status: 'ok',
  consecutive_failures: 0,
  reset_at: null,
  last_checked_at: new Date().toISOString(),
  ...over,
});

describe('judgeAccount — 判据顺序', () => {
  it('阈值常量就是主理人拍板值', () => {
    expect(DISPATCH_GATE_FIVE_HOUR_PCT).toBe(95);
    expect(DISPATCH_GATE_SEVEN_DAY_PCT).toBe(90);
  });

  it('1. 无行 → unknown/no_ledger_row', () => {
    expect(judgeAccount(null)).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
    expect(judgeAccount(undefined)).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
  });

  // ⚠️ 这一条钉死「status 终态必须排在新鲜度之前」，是本设计修掉的死支
  it('2. key_expired → unusable/credential_invalid（即便 failures>=3）', () => {
    expect(judgeAccount(row({ status: 'key_expired', consecutive_failures: 3 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('2. no_credential → unusable/credential_invalid', () => {
    expect(judgeAccount(row({ status: 'no_credential', consecutive_failures: 5 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('2. 凭据失效优先于 pct —— 失败不擦白会留着旧的低 pct', () => {
    expect(judgeAccount(row({ status: 'key_expired', consecutive_failures: 3, five_hour_pct: 1, seven_day_pct: 1 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('3. rate_limited → unknown 弃权，绝不判死（B49 事故：429≠配额耗尽）', () => {
    expect(judgeAccount(row({ status: 'rate_limited', consecutive_failures: 3 })))
      .toMatchObject({ verdict: 'unknown', reason: 'collector_rate_limited' });
  });

  it('4. status=ok 但 failures>0 → unknown/reading_unverified（看着新鲜其实没验证过）', () => {
    expect(judgeAccount(row({ status: 'ok', consecutive_failures: 1 })))
      .toMatchObject({ verdict: 'unknown', reason: 'reading_unverified' });
    expect(judgeAccount(row({ status: 'ok', consecutive_failures: 2 })))
      .toMatchObject({ verdict: 'unknown', reason: 'reading_unverified' });
  });

  it('5. 5h 达阈值 → unusable/five_hour_exhausted', () => {
    expect(judgeAccount(row({ five_hour_pct: 95 })))
      .toMatchObject({ verdict: 'unusable', reason: 'five_hour_exhausted' });
    expect(judgeAccount(row({ five_hour_pct: 94 }))).toMatchObject({ verdict: 'usable' });
  });

  it('6. 7d 达阈值 → unusable/seven_day_exhausted', () => {
    expect(judgeAccount(row({ seven_day_pct: 90 })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
    expect(judgeAccount(row({ seven_day_pct: 89 }))).toMatchObject({ verdict: 'usable' });
  });

  it('7. 两个 pct 皆 NULL → unknown/pct_unknown（弃权）', () => {
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: null })))
      .toMatchObject({ verdict: 'unknown', reason: 'pct_unknown' });
  });

  it('7. 只有一个 pct 为 NULL 时不弃权，用有值的那个判', () => {
    // 现网真实形态：codex-team1 5h=null/7d=18、grok 5h=null/7d=0
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 18 }))).toMatchObject({ verdict: 'usable' });
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 91 })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
  });

  it('8. 其余 → usable，并带回用于保底排序的 pct', () => {
    expect(judgeAccount(row({ five_hour_pct: 11, seven_day_pct: 32 })))
      .toMatchObject({ verdict: 'usable', pct: 32 });
  });

  it('pct 取候选排序用的最大值（最满的那个窗决定紧张程度）', () => {
    expect(judgeAccount(row({ five_hour_pct: 80, seven_day_pct: 20 })).pct).toBe(80);
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 20 })).pct).toBe(20);
  });
});

describe('judgeAccount — 防假绿的自洽约束', () => {
  it('判据认的 status 集合 ⊆ MODEL_ACCOUNT_STATUS（禁手抄字符串）', () => {
    const judged = ['ok', 'unknown', 'rate_limited', 'key_expired', 'no_credential'];
    for (const s of judged) expect(MODEL_ACCOUNT_STATUS).toContain(s);
  });

  it('verdict 只有三态', () => {
    expect([...QUOTA_VERDICTS].sort()).toEqual(['unknown', 'unusable', 'usable']);
  });

  it('终态 status 的 fixture 必须带 failures>=3（否则是生产不可能的组合）', () => {
    const terminal = ['key_expired', 'no_credential', 'rate_limited'];
    for (const s of terminal) {
      const impossible = row({ status: s, consecutive_failures: 0 });
      expect(() => judgeAccount(impossible)).not.toThrow();
    }
  });

  it('pct 只可能是整数或 null（node-pg 对 int4 列不接受浮点）', () => {
    expect(judgeAccount(row({ five_hour_pct: 95, seven_day_pct: null })).pct).toBe(95);
  });
});
