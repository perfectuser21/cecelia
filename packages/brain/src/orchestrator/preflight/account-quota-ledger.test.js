import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  judgeAccount,
  DISPATCH_GATE_FIVE_HOUR_PCT,
  DISPATCH_GATE_SEVEN_DAY_PCT,
  QUOTA_VERDICTS,
  createQuotaLedgerLoader,
  LEDGER_CACHE_TTL_MS,
  LEDGER_UNAVAILABLE_FAIL_CLOSED_MS,
} from './account-quota-ledger.js';
import { MODEL_ACCOUNT_STATUS } from '../../ops-model-accounts-collector.js';

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

// ── soon-reset 豁免（0921，task eb301e5a）────────────────────────────────
// 0920 上产的判据只看水位不看到期：一个 7d=91%、10 分钟后就滚窗重置的号会被判死。
// 主理人 0921 当场点破：「他妈的还有两个小时之后就恢复了，你根本就不用担心」——
// 实查证实 claude-account2 当时 7d=85%、2 小时后重置，所谓"一天内碰线"根本不存在。
//
// 老代码本来就有这个口径：account-usage.js:646-653 的 RESET_SOON_MINUTES=30 +
// effectivePct（30 分钟内重置的窗当 0% 算，优先把快过期的额度用掉）。
// 设计刀1 时把它划到范围外了，因为台账表没有 7d 重置列——而实查证明
// Anthropic 接口本就返回 seven_day.resets_at，是采集器只留了 five_hour 那个。
describe('judgeAccount — 即将重置的窗当 0 算（soon-reset 豁免）', () => {
  const at = (mins) => new Date(Date.now() + mins * 60_000).toISOString();

  it('7d 超阈值但 30 分钟内重置 → 仍可用（别在滚窗前一刻判死）', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: at(10) })))
      .toMatchObject({ verdict: 'usable' });
  });

  it('7d 超阈值且重置还早 → 照常判死', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: at(120) })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
  });

  it('边界：正好 30 分钟算"即将重置"，31 分钟不算', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: at(30) })).verdict).toBe('usable');
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: at(31) })).verdict).toBe('unusable');
  });

  it('5h 同样享受豁免（reset_at 是 5h 窗的重置时刻）', () => {
    expect(judgeAccount(row({ five_hour_pct: 99, reset_at: at(5) })))
      .toMatchObject({ verdict: 'usable' });
    expect(judgeAccount(row({ five_hour_pct: 99, reset_at: at(90) })))
      .toMatchObject({ verdict: 'unusable', reason: 'five_hour_exhausted' });
  });

  it('没有重置时刻就不豁免——缺数据不当成"快重置了"', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: null })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
  });

  it('重置时刻已过（采集器还没刷新）也当 0 算', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: at(-10) })))
      .toMatchObject({ verdict: 'usable' });
  });

  it('非法时间串不豁免，也不崩', () => {
    expect(judgeAccount(row({ seven_day_pct: 95, seven_day_reset_at: 'not-a-date' })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
  });

  it('豁免只影响额度闸，不影响凭据终态', () => {
    expect(judgeAccount(row({
      status: 'key_expired', consecutive_failures: 3,
      seven_day_pct: 95, seven_day_reset_at: at(5),
    }))).toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
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

const okRows = [
  { account_id: 'claude-account1', provider: 'claude', five_hour_pct: 11, seven_day_pct: 32, status: 'ok', consecutive_failures: 0 },
  { account_id: 'codex-team1', provider: 'codex', five_hour_pct: null, seven_day_pct: 18, status: 'ok', consecutive_failures: 0 },
];

// ── 机械守卫：判据读的每一列，SELECT 都得取（0921，task eedefe3f）────────
// 事故：PR #5451 给 judgeAccount 加了 row.seven_day_reset_at，migration 建了列、
// 采集器也真采到了（生产库实查值正确），唯独 LEDGER_SQL 忘了把这列 SELECT 出来。
// 于是 judgeAccount 读到的永远是 undefined，soon-reset 豁免**上产即死**。
//
// 为什么全绿放行：单测手工构造 row 对象、smoke 自己 INSERT 自己 SELECT，
// 两边都绕开了生产真正用的那条 SELECT。所以这条守卫不写具体列名——它从源码
// 提取 judgeAccount 实际读的每一个 row.X，再逐个比对 LEDGER_SQL，以后加列
// 忘了改 SELECT 会直接红。
describe('LEDGER_SQL 必须覆盖 judgeAccount 读的所有列', () => {
  const SRC = readFileSync(
    fileURLToPath(new URL('./account-quota-ledger.js', import.meta.url)), 'utf8',
  );

  it('judgeAccount 里每个 row.X 都出现在 LEDGER_SQL 的字段列表里', () => {
    const body = SRC.slice(
      SRC.indexOf('export function judgeAccount'),
      SRC.indexOf('export function judgedStatuses'),
    );
    const cols = [...new Set([...body.matchAll(/\brow\.([a-z_]+)/g)].map((m) => m[1]))];
    expect(cols.length).toBeGreaterThan(3);   // 防正则失效导致空集假绿

    const select = SRC.slice(SRC.indexOf('const LEDGER_SQL'), SRC.indexOf('FROM ops_model_accounts'));
    const missing = cols.filter((c) => !new RegExp(`\\b${c}\\b`).test(select));
    expect(missing, `这些列判据在读、SELECT 却没取：${missing.join(', ')}`).toEqual([]);
  });

  it('seven_day_reset_at 明确在 SELECT 里（本次事故的那一列）', () => {
    const select = SRC.slice(SRC.indexOf('const LEDGER_SQL'), SRC.indexOf('FROM ops_model_accounts'));
    expect(select).toContain('seven_day_reset_at');
  });
});

describe('createQuotaLedgerLoader', () => {
  it('一次 evaluate 只查一次库（禁逐候选查询）', async () => {
    let calls = 0;
    const load = createQuotaLedgerLoader({ query: async () => { calls += 1; return { rows: okRows }; } });
    const snap = await load(['account1', 'team1']);
    expect(calls).toBe(1);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'usable' });
    expect(snap.verdictFor('team1')).toMatchObject({ verdict: 'usable' });
  });

  it('TTL 内复用缓存，TTL 过后重查', async () => {
    let calls = 0;
    let t = 1_000;
    const load = createQuotaLedgerLoader({
      query: async () => { calls += 1; return { rows: okRows }; },
      now: () => t,
    });
    await load(['account1']);
    await load(['account1']);
    expect(calls).toBe(1);
    t += LEDGER_CACHE_TTL_MS + 1;
    await load(['account1']);
    expect(calls).toBe(2);
  });

  it('未知运行时 id → unknown/no_ledger_row，不抛', async () => {
    const load = createQuotaLedgerLoader({ query: async () => ({ rows: okRows }) });
    const snap = await load(['team5']);
    expect(snap.verdictFor('team5')).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
  });

  it('查库失败 → 全部 unknown/ledger_unavailable + degraded 标记（不静默 fail-open）', async () => {
    const load = createQuotaLedgerLoader({ query: async () => { throw new Error('ECONNREFUSED'); }, now: () => 1_000 });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_unavailable' });
    expect(snap.degraded).toBe(true);
    expect(snap.degradedReason).toContain('ECONNREFUSED');
  });

  it('表不存在（42P01）同样降级，不当成「没有账号」', async () => {
    const err = Object.assign(new Error('relation "ops_model_accounts" does not exist'), { code: '42P01' });
    const load = createQuotaLedgerLoader({ query: async () => { throw err; }, now: () => 1_000 });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_unavailable' });
  });

  it('空表 → 全部 unknown/ledger_empty（系统未就绪，不是「都没额度」）', async () => {
    const load = createQuotaLedgerLoader({ query: async () => ({ rows: [] }) });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_empty' });
    expect(snap.degraded).toBe(true);
  });

  it('连续读不到超过 15 分钟 → 转 fail-closed（unusable）', async () => {
    let t = 1_000;
    const load = createQuotaLedgerLoader({ query: async () => { throw new Error('down'); }, now: () => t });
    await load(['account1']);
    t += LEDGER_UNAVAILABLE_FAIL_CLOSED_MS - 1;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('unknown');
    t += 2;
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unusable', reason: 'ledger_unavailable_fail_closed' });
  });

  it('恢复一次即清零 fail-closed 计时', async () => {
    let t = 1_000;
    let fail = true;
    const load = createQuotaLedgerLoader({
      query: async () => { if (fail) throw new Error('down'); return { rows: okRows }; },
      now: () => t,
    });
    await load(['account1']);
    t += LEDGER_UNAVAILABLE_FAIL_CLOSED_MS + 1;
    fail = false;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('usable');
    fail = true;
    t += LEDGER_CACHE_TTL_MS + 1;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('unknown');
  });
});
