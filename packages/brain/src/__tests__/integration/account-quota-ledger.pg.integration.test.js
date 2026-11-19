// [integration] 真 PG。unit shard 不跑（ci.yml brain-unit 用 `--exclude='src/__tests__/integration/**'`
// 整目录排除），由 brain-integration job 起 pgvector service（一次性容器，随 job 销毁）+
// 跑 migration 后，通过 `src/__tests__/integration/` 目录参数自动发现执行。
//
// 本文件钉死一条只有真 PG 才能验的事实：INTEGER 列 + node-pg 参数绑定 = 浮点直接抛，
// 不取整。这是 toPct 必须 Math.round 的根据（collector 的 upsert 在 try 之外，
// 一抛就中断整轮采集，后面的账号静默陈旧——见 ops-model-accounts-collector.js:107-114）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { createQuotaLedgerLoader } from '../../orchestrator/preflight/account-quota-ledger.js';
import { runModelAccountsCollector } from '../../ops-model-accounts-collector.js';

const pool = new pg.Pool({ ...DB_DEFAULTS });

// brain-integration 的 pgvector service 容器是一次性的（随 job 起、随 job 销毁，
// 见 .github/workflows/ci.yml brain-integration job），且全仓只有本文件在
// src/__tests__/integration/ 下写 ops_model_accounts（另两个写这张表的文件是
// account-quota-ledger.test.js / ops-model-accounts-collector.test.js，都是
// unit 测试，brain-unit 用 --exclude 整目录排除、不会跑到这张真表）。
// 本fixture会清理真实格式的账号id，因此仅允许CI+POSTGRES显式开关下的一次性服务库；
// 禁止在本机持久scratch/test库执行，不能将DELETE称为事务回滚。
const TEST_LEDGER_IDS = ['itest-float', 'itest-int', 'codex-team1', 'codex-team2'];
const cleanup = () => pool.query(
  `DELETE FROM ops_model_accounts WHERE account_id = ANY($1::text[])`,
  [TEST_LEDGER_IDS],
);

describe.skipIf(process.env.CI !== 'true' || process.env.POSTGRES_INTEGRATION !== '1')('[integration] ledger 装载器打真表', () => {
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('INTEGER 列拒收浮点参数绑定——这就是 toPct 必须取整的原因', async () => {
    await expect(
      pool.query(
        `INSERT INTO ops_model_accounts
           (account_id, provider, five_hour_pct, host_alias, forwardable, forward_targets, status)
         VALUES ($1,$2,$3,'mmv',false,'[]'::jsonb,'ok')`,
        ['itest-float', 'codex', 89.6],
      ),
    ).rejects.toThrow(/invalid input syntax for type integer/);
  });

  it('整数参数绑定正常入库', async () => {
    const r = await pool.query(
      `INSERT INTO ops_model_accounts
         (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ($1,$2,$3,$4,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET five_hour_pct=EXCLUDED.five_hour_pct
       RETURNING five_hour_pct, seven_day_pct`,
      ['itest-int', 'codex', 90, 32],
    );
    expect(r.rows[0]).toMatchObject({ five_hour_pct: 90, seven_day_pct: 32 });
  });

  it('真表读出的行能被判据消费（走真实账号 id 映射）', async () => {
    await pool.query(
      `INSERT INTO ops_model_accounts
         (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ('codex-team1','codex',11,32,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct=11, seven_day_pct=32, status='ok', consecutive_failures=0`,
    );
    const load = createQuotaLedgerLoader({ pool });
    const snap = await load();
    expect(snap.degraded).toBe(false);
    expect(snap.verdictFor('team1')).toMatchObject({ verdict: 'usable' });
  });

  it('阈值边界按整数 90/95 生效（表里不可能有 89.5）', async () => {
    await pool.query(
      `INSERT INTO ops_model_accounts
         (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ('codex-team2','codex',10,90,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct=10, seven_day_pct=90, status='ok', consecutive_failures=0`,
    );
    const load = createQuotaLedgerLoader({ pool });
    const snap = await load();
    expect(snap.verdictFor('team2')).toMatchObject({
      verdict: 'unusable', reason: 'seven_day_exhausted',
    });
  });

  it('整轮真实采集只更新现役六账号，旧 Claude 历史行完整保留且不刷新', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ops_model_accounts
           (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable,
            forward_targets, status, consecutive_failures, last_error, last_checked_at, updated_at)
         VALUES ('claude-account1','claude',73,84,'retired-history',false,'[]'::jsonb,
                 'unknown',7,'historical-collector-failure','2000-01-01','2000-01-01')
         ON CONFLICT (account_id) DO UPDATE SET
           five_hour_pct=73, seven_day_pct=84, host_alias='retired-history', status='unknown',
           consecutive_failures=7, last_error='historical-collector-failure',
           last_checked_at='2000-01-01', updated_at='2000-01-01'`,
      );
      const readHistory = () => client.query(
        "SELECT * FROM ops_model_accounts WHERE account_id='claude-account1'",
      );
      const before = (await readHistory()).rows;
      const probed = [];
      const result = await runModelAccountsCollector(client, {
        force: true,
        retryDelayMs: 0,
        fetchUsage: async account => {
          probed.push(account.account_id);
          return account.provider === 'grok'
            ? { five_hour_pct: null, seven_day_pct: null }
            : { five_hour: { usage_percent: 12 }, seven_day: { usage_percent: 34 } };
        },
      });
      const activeIds = ['codex-team1', 'codex-team2', 'codex-team3', 'codex-team4', 'codex-team5', 'grok'];
      expect(probed).toEqual(activeIds);
      expect(result.results).toEqual(activeIds.map(account_id => ({ account_id, status: 'ok' })));
      const { rows } = await client.query(
        `SELECT account_id, provider, five_hour_pct, seven_day_pct, status, consecutive_failures
         FROM ops_model_accounts WHERE account_id=ANY($1::text[]) ORDER BY account_id`,
        [activeIds],
      );
      expect(rows).toEqual(activeIds.map(account_id => ({
        account_id, provider: account_id === 'grok' ? 'grok' : 'codex',
        five_hour_pct: account_id === 'grok' ? null : 12,
        seven_day_pct: account_id === 'grok' ? null : 34,
        status: 'ok', consecutive_failures: 0,
      })));
      expect((await readHistory()).rows).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
