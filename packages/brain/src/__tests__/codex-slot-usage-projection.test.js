/**
 * Codex Slot usage 投影集成回归。
 *
 * 禁 mock 边：broker ↔ 本地 HTTP wham fixture ↔ 真 PostgreSQL
 * account_usage_cache ↔ llm-capacity / credentials-health。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import pool from '../db.js';
import {
  CODEX_USAGE_ACCOUNTS,
  refreshCodexUsageProjection,
  resetCodexUsageRefreshForTests,
} from '../codex-slot-broker.js';
import {
  clearLlmCapacityCache,
  getLlmCapacitySnapshot,
} from '../llm-capacity.js';
import { checkCodexAuth } from '../credentials-health-scheduler.js';

let server;
let whamUrl;
let requestCount = 0;
let failedAccounts = new Set();
let preservedRows = [];

function fixtureUsage(team) {
  const index = Number(team.slice(4));
  return {
    rate_limit: {
      primary_window: {
        used_percent: index * 7,
        reset_after_seconds: 120,
      },
      secondary_window: {
        used_percent: index * 9,
        reset_after_seconds: 3600,
      },
    },
  };
}

beforeAll(async () => {
  const preserved = await pool.query(
    `SELECT account_id, five_hour_pct, seven_day_pct, seven_day_resets_at, fetched_at
       FROM account_usage_cache
      WHERE account_id = ANY($1::text[])`,
    [[...CODEX_USAGE_ACCOUNTS, 'account1']],
  );
  preservedRows = preserved.rows;

  server = createServer((req, res) => {
    requestCount += 1;
    const accountHeader = String(req.headers['chatgpt-account-id'] || '');
    const team = accountHeader.replace(/^acct-/, '');
    if (!CODEX_USAGE_ACCOUNTS.includes(team) || failedAccounts.has(team)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'fixture unavailable' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fixtureUsage(team)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  whamUrl = `http://127.0.0.1:${server.address().port}/backend-api/wham/usage`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.query(
    `DELETE FROM account_usage_cache
      WHERE account_id = ANY($1::text[])`,
    [[...CODEX_USAGE_ACCOUNTS, 'account1']],
  );
  for (const row of preservedRows) {
    await pool.query(
      `INSERT INTO account_usage_cache
         (account_id, five_hour_pct, seven_day_pct, seven_day_resets_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct = EXCLUDED.five_hour_pct,
         seven_day_pct = EXCLUDED.seven_day_pct,
         seven_day_resets_at = EXCLUDED.seven_day_resets_at,
         fetched_at = EXCLUDED.fetched_at`,
      [
        row.account_id,
        row.five_hour_pct,
        row.seven_day_pct,
        row.seven_day_resets_at,
        row.fetched_at,
      ],
    );
  }
  resetCodexUsageRefreshForTests();
  clearLlmCapacityCache();
});

describe('broker 唯一 issuer usage projection', () => {
  it('singleflight 真 HTTP 写入 team1..5，llm/health 只读 exact Codex 闭集', async () => {
    await pool.query(
      `DELETE FROM account_usage_cache
        WHERE account_id = ANY($1::text[])`,
      [CODEX_USAGE_ACCOUNTS],
    );
    await pool.query(
      `INSERT INTO account_usage_cache
         (account_id, five_hour_pct, seven_day_pct, fetched_at)
       VALUES ('account1', 77, 66, NOW())
       ON CONFLICT (account_id) DO UPDATE SET
         five_hour_pct = 77, seven_day_pct = 66, fetched_at = NOW()`,
    );

    requestCount = 0;
    failedAccounts = new Set();
    resetCodexUsageRefreshForTests();
    const dependencies = {
      pool,
      whamUrl,
      loadAuth: async team => ({
        accessToken: `fixture-secret-${team}`,
        accountId: `acct-${team}`,
      }),
    };
    await Promise.all([
      refreshCodexUsageProjection(dependencies),
      refreshCodexUsageProjection(dependencies),
      refreshCodexUsageProjection(dependencies),
    ]);
    expect(requestCount).toBe(5);

    const projected = await pool.query(
      `SELECT account_id, five_hour_pct, seven_day_pct
         FROM account_usage_cache
        WHERE account_id = ANY($1::text[])
        ORDER BY account_id`,
      [CODEX_USAGE_ACCOUNTS],
    );
    expect(projected.rows.map(row => row.account_id)).toEqual(CODEX_USAGE_ACCOUNTS);
    expect(JSON.stringify(projected.rows)).not.toContain('fixture-secret');

    clearLlmCapacityCache();
    const capacity = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(capacity.vendors.codex.accounts.map(row => row.name)).toEqual(CODEX_USAGE_ACCOUNTS);
    expect(capacity.vendors.codex.accounts.some(row => row.name === 'account1')).toBe(false);

    const health = await checkCodexAuth(pool);
    expect(health).toHaveLength(5);
    expect(health.every(row => row.status === 'ok')).toBe(true);
    expect(health.map(row => row.account)).toEqual(CODEX_USAGE_ACCOUNTS);

    failedAccounts = new Set(['team5']);
    await refreshCodexUsageProjection({ ...dependencies, force: true });
    const afterFailure = await pool.query(
      `SELECT account_id FROM account_usage_cache
        WHERE account_id = ANY($1::text[]) ORDER BY account_id`,
      [CODEX_USAGE_ACCOUNTS],
    );
    expect(afterFailure.rows.map(row => row.account_id)).toEqual(CODEX_USAGE_ACCOUNTS.slice(0, 4));
    const claude = await pool.query(
      `SELECT five_hour_pct FROM account_usage_cache WHERE account_id = 'account1'`,
    );
    expect(Number(claude.rows[0].five_hour_pct)).toBe(77);
  });
});
