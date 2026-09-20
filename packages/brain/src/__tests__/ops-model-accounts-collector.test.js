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
  buildProbeCmd,
  runModelAccountsCollector,
  toPctForTest,
} from '../ops-model-accounts-collector.js';

// 本文件里没有共享的 makePool fixture（各测试文件各自本地定义，见
// machine-vitals.test.js:25-27 的同款惯例），本文件此前的 query mock 也是就地写的
// 匿名对象（见上面 buildProbeCmd 的第二个用例）。这里补一个带 upserts() 便于按
// SQL 特征取出成功 upsert 调用参数——ops_model_accounts 表有两条 INSERT 语句
// （成功 upsertModelAccount 带 pct 列 / 失败 upsertModelAccountFailure 不带），
// 用 `five_hour_pct=EXCLUDED` 只挑出前者，避免误把失败分支的 host_alias/forwardable
// 参数位当成 pct 位检查。
function makePool() {
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
    upserts: () => calls.filter((c) => /five_hour_pct=EXCLUDED/.test(c.sql)),
  };
}

describe('buildProbeCmd（真采集命令：探针走 stdin，凭据不出宿主）', () => {
  it('base64 投递探针脚本 + node 从 stdin 执行 + --run provider path；命令里不含凭据内容', () => {
    const acct = MODEL_ACCOUNTS.find((a) => a.account_id === 'codex-team1');
    const cmd = buildProbeCmd(acct, '/opt/homebrew/bin/node');
    expect(cmd).toMatch(/^echo [A-Za-z0-9+/=]+ \| base64 -d \| \/opt\/homebrew\/bin\/node --input-type=module - -- --probe-run codex ~\/\.codex-team1\/auth\.json$/);
    const b64 = cmd.split(' ')[1];
    const source = Buffer.from(b64, 'base64').toString('utf8');
    expect(source).toContain('normalizeWhamUsage');
    expect(source).toContain("process.argv.indexOf('--probe-run')");
    expect(cmd).not.toMatch(/access_token|accessToken|Bearer /);
  });

  it('探针失败只把 stderr 一行结论上抛（不带命令/凭据路径），分类才不会全落 no_credential', async () => {
    const calls = [];
    const exec = (cmd) => {
      calls.push(cmd);
      const err = new Error(`Command failed: ${cmd}`);
      err.status = 4;
      err.stderr = 'anthropic usage HTTP 429\n';
      throw err;
    };
    const queries = [];
    const pool = { query: async (sql, params) => { queries.push(params); return { rows: [] }; } };
    const { runModelAccountsCollector } = await import('../ops-model-accounts-collector.js');
    const r = await runModelAccountsCollector(pool, { only: 'claude-account1', exec, inContainer: false });
    // 429 有独立分类（0920，任务 424d9dd2）：此前归 unknown，与「真没查到」混为一谈，
    // 读侧既看不出该退避、也看不出账号其实健康。
    expect(r.results).toEqual([{ account_id: 'claude-account1', status: 'rate_limited' }]);
    expect(calls[0]).toContain('--probe-run claude ~/.claude-account1/.credentials.json');
    // 失败路径走 upsertModelAccountFailure（不含 pct 列），last_error 在第 8 个参数位
    expect(queries[0][7]).toBe('anthropic usage HTTP 429');
  });
});

const SNAPSHOT_KEYS = ['five_hour_pct', 'seven_day_pct', 'reset_at'];

describe('ops-model-accounts-collector 纯函数', () => {
  it('status 五态枚举齐全（ok|unknown|rate_limited|key_expired|no_credential）', () => {
    // rate_limited 于 0920 加入（任务 424d9dd2）：429 ≠ 配额耗尽，也 ≠ 查不到，
    // 必须单独一态，读侧才分得清「该退避」与「账号有问题」。
    expect([...MODEL_ACCOUNT_STATUS].sort()).toEqual(
      ['key_expired', 'no_credential', 'ok', 'rate_limited', 'unknown'].sort(),
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

describe('toPct — 列是 INTEGER，浮点必须在进 SQL 前收敛', () => {
  // 实测（node-pg + 真 PG）：参数绑定传 89.6 会抛
  // `invalid input syntax for type integer: "89.6"`，而 :365-366 的 upsert
  // 在 try 之外 —— 一抛就中断整轮采集，后面的账号静默陈旧。
  it('小数四舍五入成整数', () => {
    expect(toPctForTest(89.6)).toBe(90);
    expect(toPctForTest(89.4)).toBe(89);
    expect(toPctForTest(89.5)).toBe(90);
    expect(toPctForTest(94.5)).toBe(95);
  });

  it('整数原样透传', () => {
    expect(toPctForTest(0)).toBe(0);
    expect(toPctForTest(100)).toBe(100);
  });

  it('缺失/非数字仍然诚实留空（禁编造 0）', () => {
    expect(toPctForTest(undefined)).toBeNull();
    expect(toPctForTest(null)).toBeNull();
    expect(toPctForTest('91')).toBeNull();
    expect(toPctForTest(NaN)).toBeNull();
    expect(toPctForTest(Infinity)).toBeNull();
  });

  it('写库参数里不存在非整数（回归：整轮采集不再被一个小数打断）', async () => {
    const pool = makePool();
    await runModelAccountsCollector(pool, {
      force: true,
      fetchUsage: async () => ({ five_hour: { utilization: 89.6 }, seven_day: { utilization: 12.3 } }),
      grokProbe: async () => ({ five_hour_pct: 1.5, seven_day_pct: 2.5 }),
    });
    // upsertModelAccount 的参数数组（源文件 :274-279）：
    //   [account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at,
    //    host_alias, forwardable, forward_targets, status, last_error]
    // pct 两列在下标 3、4（0-based）——核对过 SQL 的 $4/$5 与数组字面量顺序一致。
    const pctParams = pool.upserts().flatMap((c) => (c.params ?? []).slice(3, 5));
    expect(pctParams.length).toBeGreaterThan(0);
    for (const p of pctParams) {
      if (p === null || p === undefined) continue;
      expect(Number.isInteger(p)).toBe(true);
    }
  });
});
