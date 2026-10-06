#!/usr/bin/env bash
# alarm-ledger-smoke — 闹钟总账（迁移 517，任务 fe10d1a0，决策 9e9d90b6）真库真代码火：
# 排程台账 ops_schedule_entries 加了 15 个总账列（未新建表）；Brain job / recurring 经真实代码落表后，
# 人写的归属/备注/挂树列在机器后续刷新里原样保留；盘点导入幂等只补空；非法口径值被 CHECK 拦下；
# /alarms 数据面能读出挂树路径。纯真 PG + 真函数，无 mock；CI real-env-smoke 在 cecelia_test 上跑。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"

q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TAG="alarm-ledger-smoke-$$"
cleanup() {
  q "DELETE FROM ops_schedule_entries WHERE label LIKE '${TAG}%' OR host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM recurring_tasks WHERE title LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_workflows WHERE wf_id LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM capabilities WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM value_streams WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 排程台账加列（15 个），没有新建总账表
for c in interval_sec enabled last_run_at last_success_at last_status liveness silent_sec registered_via ledger_status \
         workflow_id journey_id ops_workflow_id owner_manual note_manual tree_bucket_manual; do
  has="$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_schedule_entries' AND column_name='$c'")"
  [[ "$has" == "1" ]] || fail "ops_schedule_entries 缺列 $c（迁移 517 未跑？）"
done
for t in alarm_ledger alarms ops_alarm_ledger; do
  [[ "$(q "SELECT to_regclass('public.$t') IS NOT NULL")" == "f" ]] || fail "不该出现新的总账表 $t（决策 9e9d90b6：扩现成表）"
done
pass "迁移 517：排程台账 15 个总账列齐全，且未新建总账表"

# 2. CHECK 约束拦非法口径值
for bad in "ledger_status='maybe'" "last_status='乱写'" "registered_via='cron-by-hand'"; do
  col="${bad%%=*}"; val="${bad#*=}"
  if q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,${col}) VALUES ('crontab','${TAG}-h','${TAG}-bad-${col}','crontab',${val})" >/dev/null 2>&1; then
    fail "CHECK 约束没拦住非法值 ${bad}（口径会漂移）"
  fi
done
pass "CHECK 约束拦住非法 ledger_status / last_status / registered_via"

# 3. 真代码落表：Brain job + recurring + 盘点导入 + /alarms 数据面（一个 node 进程，同一个真 PG）
q "INSERT INTO recurring_tasks (title, task_type, cron_expression, is_active, last_run_at, last_run_status)
   VALUES ('${TAG}-rec', 'dev', '0 9 * * *', TRUE, NOW(), 'created')" >/dev/null
q "INSERT INTO value_streams (name, journey_type) VALUES ('${TAG}-vs', 'autonomous')" >/dev/null
q "INSERT INTO capabilities (name, journey_type, parent_journey_id)
   SELECT '${TAG}-vs · cap', 'autonomous', id FROM value_streams WHERE name='${TAG}-vs'" >/dev/null

(cd "$BRAIN_DIR" && SMOKE_TAG="$TAG" DB_NAME="$DB_NAME" "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { upsertBrainJobLedger, syncRecurringLedger } from './src/ops-alarm-ledger.js';
import { importInventorySnapshot } from './src/ops-alarm-import.js';
import { buildAlarmsPayload } from './src/routes/agent-ops.js';

const tag = process.env.SMOKE_TAG;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const ok = (m) => console.log(`PASS: ${m}`);
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const row = (label, source = 'brain', host = 'us-vps') => one(
  'SELECT * FROM ops_schedule_entries WHERE source=$1 AND host_alias=$2 AND label=$3', [source, host, label]);

try {
  // 3a. Brain job 落表：登记为 brain-job/registered，周期结构化
  const job = { name: `${tag}-job`, cadence: { cron: '30 8 * * *', tz: 'Asia/Shanghai' } };
  const at = new Date().toISOString();
  await upsertBrainJobLedger(pool, { job, lastRunAt: at, rec: { ok: true }, lv: { liveness: 'ok', silent_sec: 3 }, collectedAt: at });
  let r = await row(job.name);
  if (!r) die('Brain job 没落进 ops_schedule_entries');
  if (r.kind !== 'brain_job' || r.registered_via !== 'brain-job' || r.ledger_status !== 'registered' || r.interval_sec !== 86400 || r.last_status !== '正常') {
    die(`Brain job 行不对: ${JSON.stringify({ k: r.kind, v: r.registered_via, l: r.ledger_status, i: r.interval_sec, s: r.last_status })}`);
  }
  ok('Brain job 经真实代码落总账（brain-job/registered/周期 86400/正常）');

  // 3b. 人写归属/备注/暂存归属 → 机器后续刷新（周期变了+状态变了）原样保留
  await pool.query(`UPDATE ops_schedule_entries SET owner_manual='alex', note_manual='人写备注', tree_bucket_manual='暂存归属' WHERE id=$1`, [r.id]);
  await upsertBrainJobLedger(pool, {
    job: { ...job, cadence: { everySec: 600 } }, lastRunAt: at, rec: { ok: false, error: 'x' },
    lv: { liveness: 'warn', silent_sec: 5000 }, collectedAt: new Date(Date.now() + 1000).toISOString(),
  });
  r = await row(job.name);
  if (r.interval_sec !== 600 || r.last_status !== '失败') die(`机器列没刷新: ${r.interval_sec}/${r.last_status}`);
  if (r.owner_manual !== 'alex' || r.note_manual !== '人写备注' || r.tree_bucket_manual !== '暂存归属') {
    die(`机器刷新冲掉了人工列: ${JSON.stringify({ o: r.owner_manual, n: r.note_manual, t: r.tree_bucket_manual })}`);
  }
  ok('机器刷新只动机器列，人写的归属/备注/暂存归属原样保留');

  // 3c. recurring 模板落表（取代 API 层拼接）
  await syncRecurringLedger(pool, new Date());
  const rec = await row(`${tag}-rec`, 'brain', 'local');
  if (!rec || rec.kind !== 'brain_recurring' || rec.registered_via !== 'recurring' || rec.interval_sec !== 86400) die('recurring 模板没落总账');
  ok('recurring 模板经真实代码落总账（brain_recurring/recurring/周期 86400）');

  // 3d. 盘点导入：已采集来源只补挂树（只补空）、未采集来源插静态快照、重跑幂等
  await pool.query(
    `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, active)
     VALUES ('crontab', 'mmv', $1, 'crontab', 'cron(UTC): 5 * * * *', TRUE)`, [`${tag}-collected.sh @ 5 * * * *`]);
  const items = [
    { name: `${tag}-collected.sh`, host: 'MMV', mech: 'crontab', freq: '每小时', en: '启用', node: `某部 / ${tag}-vs / cap`, last: '', ok: '', st: '', note: '' },
    { name: `${tag}-timer`, host: `${tag}-nas`, mech: 'synology-task', freq: '每天', en: '禁用', node: '无（历史残留）', last: '2026-09-01 10:00', ok: '无记录', st: '失败', note: '备注' },
  ];
  const dry = await importInventorySnapshot(pool, items, { dryRun: true });
  if (dry.tree_updates !== 1 || dry.inserts !== 1) die(`干跑规划不对: ${JSON.stringify(dry)}`);
  if ((await one(`SELECT count(*)::int n FROM ops_schedule_entries WHERE source='inventory-20261004' AND label=$1`, [`${tag}-timer`])).n !== 0) die('干跑不该写库');
  await importInventorySnapshot(pool, items, { dryRun: false });
  await importInventorySnapshot(pool, items, { dryRun: false }); // 幂等
  const snaps = (await pool.query(`SELECT * FROM ops_schedule_entries WHERE source='inventory-20261004' AND label=$1`, [`${tag}-timer`])).rows;
  if (snaps.length !== 1) die(`快照行应恰好 1 行（幂等），实得 ${snaps.length}`);
  const s = snaps[0];
  if (s.enabled !== false || s.last_status !== '失败' || s.registered_via !== 'external-legacy' || s.tree_bucket_manual !== '无（历史残留）') die(`快照行字段不对: ${JSON.stringify(s)}`);
  const col = await row(`${tag}-collected.sh @ 5 * * * *`, 'crontab', 'mmv');
  const cap = await one(`SELECT id FROM capabilities WHERE name=$1`, [`${tag}-vs · cap`]);
  if (col.journey_id !== cap.id || col.ledger_status !== 'registered') die('采集来源行没被补挂树/升登记');
  ok('盘点导入：采集行只补挂树、未采集来源插快照、重跑幂等');

  // 3e. /alarms 数据面读得出挂树路径、暂存文字、停用状态
  const p = await buildAlarmsPayload(pool, new Date());
  const a = p.alarms.find((x) => x.name === `${tag}-collected.sh @ 5 * * * *`);
  if (!a || a.tree.capability !== 'cap' || !String(a.tree.value_stream).startsWith(tag)) die(`/alarms 没读出挂树路径: ${JSON.stringify(a?.tree)}`);
  const b = p.alarms.find((x) => x.name === `${tag}-timer`);
  if (!b || b.enabled !== false || b.tree.path !== '无（历史残留）') die(`/alarms 没读出快照行: ${JSON.stringify(b)}`);
  ok('/alarms 数据面：挂树路径、暂存文字、停用状态都读得出');
} finally {
  await pool.end();
}
NODE
)

echo "✅ alarm-ledger-smoke 全通过"
