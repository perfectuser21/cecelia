// ops-model-accounts-collector.test.js — 采集器纯函数单测（brain-unit 无 DB 段）
//
// 配对 lint（lint-test-pairing）要求新增 packages/brain/src 源文件配套 *.test.js。
// 覆盖现役 parser、采集调用与写库参数；真实列类型及 loader 由
// integration/account-quota-ledger.pg.integration.test.js 验证。
import { describe, it, expect } from 'vitest';
import {
  MODEL_ACCOUNT_STATUS,
  MODEL_ACCOUNTS,
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
      err.stderr = 'chatgpt wham usage HTTP 429\n';
      throw err;
    };
    const queries = [];
    const pool = { query: async (sql, params) => { queries.push(params); return { rows: [] }; } };
    const { runModelAccountsCollector } = await import('../ops-model-accounts-collector.js');
    const r = await runModelAccountsCollector(pool, { only: 'codex-team1', exec, inContainer: false });
    // 429 有独立分类（0920，任务 424d9dd2）：此前归 unknown，与「真没查到」混为一谈，
    // 读侧既看不出该退避、也看不出账号其实健康。
    expect(r.results).toEqual([{ account_id: 'codex-team1', status: 'rate_limited' }]);
    expect(calls[0]).toContain('--probe-run codex ~/.codex-team1/auth.json');
    // 失败路径走 upsertModelAccountFailure（不含 pct 列），last_error 在第 8 个参数位
    expect(queries[0][7]).toBe('chatgpt wham usage HTTP 429');
  });
});

// 现役 parser 必须归一到同一 schema——这条守卫防的是「某个 provider 少给一个键、
// 下游判据静默读到 undefined」。0921 扩了三个键（task eb301e5a）：
// seven_day_reset_at 让判据能做 soon-reset 豁免，sonnet/opus 为后续 tier 判据备料。
const SNAPSHOT_KEYS = [
  'five_hour_pct', 'seven_day_pct', 'reset_at',
  'seven_day_reset_at', 'seven_day_sonnet_pct', 'seven_day_opus_pct',
];

describe('ops-model-accounts-collector 纯函数', () => {
  it('整轮采集只探测现役 Codex/Grok，停用 Claude 不再读取凭据或写入快照', async () => {
    const probed = [];
    const pool = makePool();
    const result = await runModelAccountsCollector(pool, {
      force: true,
      fetchUsage: async account => {
        probed.push(account.account_id);
        return { five_hour: { usage_percent: 12 }, seven_day: { usage_percent: 32 } };
      },
    });
    const activeIds = ['codex-team1', 'codex-team2', 'codex-team3', 'codex-team4', 'codex-team5', 'grok'];
    expect(probed).toEqual(activeIds);
    expect(result.results.map(row => row.account_id)).toEqual(activeIds);
    expect(pool.upserts().map(({ params }) => params[0])).toEqual(activeIds);
  });

  it('status 五态枚举齐全（ok|unknown|rate_limited|key_expired|no_credential）', () => {
    // rate_limited 于 0920 加入（任务 424d9dd2）：429 ≠ 配额耗尽，也 ≠ 查不到，
    // 必须单独一态，读侧才分得清「该退避」与「账号有问题」。
    expect([...MODEL_ACCOUNT_STATUS].sort()).toEqual(
      ['key_expired', 'no_credential', 'ok', 'rate_limited', 'unknown'].sort(),
    );
  });

  it('静态注册表恰好 6 个现役账号，account_id 各唯一，凭据全在 mmv', () => {
    expect(MODEL_ACCOUNTS).toHaveLength(6);
    expect(new Set(MODEL_ACCOUNTS.map((a) => a.account_id)).size).toBe(6);
    expect(MODEL_ACCOUNTS.every((a) => a.host_alias === 'mmv')).toBe(true);
  });

  it.each(['成功', '失败'])('五个Codex账号%s采集均写入当前无登记转发目的地，保留账号与状态', async (outcome) => {
    const writes = [];
    const pool = { query: async (sql, params) => {
      if (sql.includes('INSERT INTO ops_model_accounts')) writes.push({ sql, params });
      return { rows: [] };
    } };
    const result = await runModelAccountsCollector(pool, {
      force: true,
      only: 'codex',
      fetchUsage: async () => {
        if (outcome === '失败') throw new Error('no_credential: auth.json missing');
        return { five_hour: { usage_percent: 31 }, seven_day: { usage_percent: 42 } };
      },
    });
    const ids = Array.from({ length: 5 }, (_, i) => `codex-team${i + 1}`);
    expect(result.collected).toBe(5);
    expect(result.results).toEqual(ids.map(account_id => ({
      account_id, status: outcome === '成功' ? 'ok' : 'no_credential',
    })));
    expect(writes.map(({ params }) => params[0])).toEqual(ids);
    for (const { sql, params } of writes) {
      // 从真实INSERT列顺序定位绑定值，覆盖成功和失败两种写路径。
      const columns = sql.match(/INSERT INTO ops_model_accounts\s*\(([^)]+)\)/)[1]
        .split(',').map(column => column.trim());
      const value = column => params[columns.indexOf(column)];
      expect(value('provider')).toBe('codex');
      expect(value('host_alias')).toBe('mmv');
      expect(value('forwardable')).toBe(false);
      expect(JSON.parse(value('forward_targets'))).toEqual([]);
      expect(value('status')).toBe(outcome === '成功' ? 'ok' : 'no_credential');
      if (outcome === '成功') {
        expect(value('five_hour_pct')).toBe(31);
        expect(value('seven_day_pct')).toBe(42);
      }
    }
    const grok = MODEL_ACCOUNTS.find(a => a.provider === 'grok');
    expect(grok.forwardable).toBe(false);
    expect(grok.forward_targets).toEqual([]);
  });

  it('现役 parser 归一同一 schema', () => {
    const c = parseChatgptWhamUsage({ five_hour: { usage_percent: 12 }, seven_day: { usage_percent: 88 } });
    expect(Object.keys(c).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(c.five_hour_pct).toBe(12);
    expect(c.seven_day_pct).toBe(88);

    const g = parseGrokUsage({ five_hour_pct: 5, seven_day_pct: 9, reset_at: null });
    expect(Object.keys(g).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(g.five_hour_pct).toBe(5);
  });

  it('parser 遇结构缺失不抛，缺字段 → null（诚实留空，不编造 0）', () => {
    const out = parseChatgptWhamUsage({});
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
      fetchUsage: async () => ({ five_hour: { usage_percent: 89.6 }, seven_day: { usage_percent: 12.3 } }),
      grokProbe: async () => ({ five_hour_pct: 1.5, seven_day_pct: 2.5 }),
    });
    // upsertModelAccount 的参数数组（源文件 :274-279）：
    //   [account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at,
    //    host_alias, forwardable, forward_targets, status, last_error]
    // pct 两列在下标 3、4（0-based）——核对过 SQL 的 $4/$5 与数组字面量顺序一致。
    for (const { params } of pool.upserts()) {
      expect(params.slice(3, 5)).toEqual(/grok/i.test(params[1]) ? [2, 3] : [90, 12]);
    }
    const pctParams = pool.upserts().flatMap((c) => (c.params ?? []).slice(3, 5));
    expect(pctParams.length).toBeGreaterThan(0);
    for (const p of pctParams) {
      if (p === null || p === undefined) continue;
      expect(Number.isInteger(p)).toBe(true);
    }
  });
});
