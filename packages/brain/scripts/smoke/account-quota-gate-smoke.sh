#!/usr/bin/env bash
# account-quota-gate-smoke.sh — 配额闸真环境验证（G5 step1「接单即选到有额度的执行体」）
#
# 为什么需要真环境：判据的全部价值建立在「ops_model_accounts 里只可能有整数 pct」
# 这条不变量上，而这条只有真 PG 能验——node-pg 的参数绑定对 INTEGER 列**不取整**，
# 传 89.6 直接抛 invalid input syntax。unit shard 没有 PG，验不了。
#
# 本脚本走真链路：真 PG 写行 → 真 createQuotaLedgerLoader 读 → 真 judgeAccount 裁决。
# 由 ci.yml 的 real-env-smoke job 执行（带 PGHOST/PGDATABASE/... 环境变量与真 Brain 容器）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

PSQL_DB="${PGDATABASE:-cecelia_test}"
echo "▶️  account-quota-gate smoke — db=$PSQL_DB"

# ── 0. 建表（migration 幂等；本地/CI 顺序不确定时自愈）────────────
psql -d "$PSQL_DB" -v ON_ERROR_STOP=1 -q \
  -f packages/brain/migrations/449_ops_model_accounts.sql
psql -d "$PSQL_DB" -v ON_ERROR_STOP=1 -q \
  -f packages/brain/migrations/455_ops_model_accounts_failure_streak.sql

cleanup() {
  psql -d "$PSQL_DB" -q -c \
    "DELETE FROM ops_model_accounts WHERE account_id IN ('claude-account1','claude-account2','codex-team1')" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# ── 1. 铺两行真数据：一个超 7d 阈值、一个健康 ─────────────────────
psql -d "$PSQL_DB" -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO ops_model_accounts
     (account_id,provider,five_hour_pct,seven_day_pct,host_alias,forwardable,forward_targets,status,consecutive_failures)
   VALUES
     ('claude-account1','claude',10,95,'mmv',false,'[]'::jsonb,'ok',0),
     ('claude-account2','claude',10,10,'mmv',false,'[]'::jsonb,'ok',0)
   ON CONFLICT (account_id) DO UPDATE SET
     five_hour_pct=EXCLUDED.five_hour_pct, seven_day_pct=EXCLUDED.seven_day_pct,
     status='ok', consecutive_failures=0"

# ── 2. 真模块读真表出真裁决 ───────────────────────────────────────
node --input-type=module -e "
import pg from 'pg';
const { createQuotaLedgerLoader } = await import('./packages/brain/src/orchestrator/preflight/account-quota-ledger.js');
const pool = new pg.Pool({});          // 走 PG* 环境变量
const fail = (m) => { console.error('❌ ' + m); process.exitCode = 1; };

// 浮点必须在**参数绑定**路径上被拒 —— 这是 toPct 必须 Math.round 的根据。
// 注意只有参数绑定会抛；SQL 字面量 89.6 会被 PG 的 assignment cast 取整后接受，
// 所以这条断言不能用 psql -c 写（采集器走的正是参数绑定）。
let floatRejected = false;
try {
  await pool.query(
    'INSERT INTO ops_model_accounts (account_id,provider,five_hour_pct,host_alias,forwardable,forward_targets,status)'
    + \" VALUES (\$1,\$2,\$3,'mmv',false,'[]'::jsonb,'ok')\",
    ['codex-team1', 'codex', 89.6],
  );
} catch (e) {
  floatRejected = /invalid input syntax for type integer/.test(String(e.message));
  if (!floatRejected) fail('浮点被拒了，但错误不是预期的 int4 语法错: ' + e.message);
}
if (!floatRejected) {
  fail('INTEGER 列竟然接受了浮点参数绑定 89.6 —— toPct 取整的前提被推翻，判据阈值语义失效');
} else { console.log('  ✅ INTEGER 列拒收浮点参数绑定'); }

const load = createQuotaLedgerLoader({ pool });
const snap = await load();

if (snap.degraded) fail('装载器报 degraded，真表读取失败: ' + snap.degradedReason);

const dead = snap.verdictFor('account1');
if (dead.verdict !== 'unusable' || dead.reason !== 'seven_day_exhausted') {
  fail('7d=95 应判 unusable/seven_day_exhausted，实际: ' + JSON.stringify(dead));
} else { console.log('  ✅ 7d=95 → unusable/seven_day_exhausted'); }

const alive = snap.verdictFor('account2');
if (alive.verdict !== 'usable') {
  fail('5h=10/7d=10 应判 usable，实际: ' + JSON.stringify(alive));
} else { console.log('  ✅ 5h=10/7d=10 → usable'); }

// 表里没有的账号必须弃权，不能静默当成可用（team*/grok 曾经就是这样 fail-open 的）
const missing = snap.verdictFor('team5');
if (missing.verdict !== 'unknown' || missing.reason !== 'no_ledger_row') {
  fail('表里无此账号应判 unknown/no_ledger_row，实际: ' + JSON.stringify(missing));
} else { console.log('  ✅ 表中无行 → unknown/no_ledger_row（弃权，不静默放行）'); }

await pool.end();
"

echo "✅ account-quota-gate smoke 通过"
