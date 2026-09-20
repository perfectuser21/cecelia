// [integration] 真 PG。unit shard 不跑（ci.yml brain-unit 用 `--exclude='src/__tests__/integration/**'`
// 整目录排除），由 brain-integration job 起 pgvector service（一次性容器，随 job 销毁）+
// 跑 migration 后，通过 `src/__tests__/integration/` 目录参数自动发现执行。
//
// 本文件钉死一条只有真 PG 才能验的事实：INTEGER 列 + node-pg 参数绑定 = 浮点直接抛，
// 不取整。这是 toPct 必须 Math.round 的根据（collector 的 upsert 在 try 之外，
// 一抛就中断整轮采集，后面的账号静默陈旧——见 ops-model-accounts-collector.js:107-114）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createQuotaLedgerLoader } from '../../orchestrator/preflight/account-quota-ledger.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// brain-integration 的 pgvector service 容器是一次性的（随 job 起、随 job 销毁，
// 见 .github/workflows/ci.yml brain-integration job），且全仓只有本文件在
// src/__tests__/integration/ 下写 ops_model_accounts（另两个写这张表的文件是
// account-quota-ledger.test.js / ops-model-accounts-collector.test.js，都是
// unit 测试，brain-unit 用 --exclude 整目录排除、不会跑到这张真表）。
// 因此用真实账号 id（claude-account1/2）落地是安全的；这里额外清一遍是为了
// 本机 cecelia_scratch 这类持久库上重复跑不留痕迹。
const TEST_LEDGER_IDS = ['itest-float', 'itest-int', 'claude-account1', 'claude-account2'];
const cleanup = () => pool.query(
  `DELETE FROM ops_model_accounts WHERE account_id = ANY($1::text[])`,
  [TEST_LEDGER_IDS],
);

describe('[integration] ledger 装载器打真表', () => {
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('INTEGER 列拒收浮点参数绑定——这就是 toPct 必须取整的原因', async () => {
    await expect(
      pool.query(
        `INSERT INTO ops_model_accounts
           (account_id, provider, five_hour_pct, host_alias, forwardable, forward_targets, status)
         VALUES ($1,$2,$3,'mmv',false,'[]'::jsonb,'ok')`,
        ['itest-float', 'claude', 89.6],
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
      ['itest-int', 'claude', 90, 32],
    );
    expect(r.rows[0]).toMatchObject({ five_hour_pct: 90, seven_day_pct: 32 });
  });

  it('真表读出的行能被判据消费（走真实账号 id 映射）', async () => {
    await pool.query(
      `INSERT INTO ops_model_accounts
         (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ('claude-account1','claude',11,32,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct=11, seven_day_pct=32, status='ok', consecutive_failures=0`,
    );
    const load = createQuotaLedgerLoader({ pool });
    const snap = await load();
    expect(snap.degraded).toBe(false);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'usable' });
  });

  it('阈值边界按整数 90/95 生效（表里不可能有 89.5）', async () => {
    await pool.query(
      `INSERT INTO ops_model_accounts
         (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ('claude-account2','claude',10,90,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct=10, seven_day_pct=90, status='ok', consecutive_failures=0`,
    );
    const load = createQuotaLedgerLoader({ pool });
    const snap = await load();
    expect(snap.verdictFor('account2')).toMatchObject({
      verdict: 'unusable', reason: 'seven_day_exhausted',
    });
  });
});
