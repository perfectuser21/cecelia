#!/usr/bin/env bash
# resource-health-smoke — 资源健康进仓库（迁移 539，决策 de6dff5d 第 5 步，任务 5bf2512a）真库真代码火：
# 执行端上报账号切换结果 → 按三态判据落当前状态；状态变化由触发器留历史；
# 调度前检查读真表：被风控/掉线的资源挡住并给原因，没记录的放行；仓库物件汇总视图给最差状态。
# 纯真 PG + 真函数，无 mock；CI real-env-smoke 在 cecelia_test 上跑。
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

q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TAG="rhsmoke$$"
cleanup() {
  q "DELETE FROM resource_health WHERE resource_key LIKE '%${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM warehouse_items WHERE key LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 结构
for t in resource_health resource_health_events v_warehouse_item_health; do
  [[ "$(q "SELECT to_regclass('public.$t') IS NOT NULL")" == "t" ]] || fail "缺 ${t}（迁移 539 未跑？）"
done
pass "迁移 539：当前状态表、状态变化历史表、仓库物件健康汇总视图齐全"

# 2. 真函数：账号切换三态 → 上报 → 调度前检查
q "INSERT INTO warehouse_items (key, name, kind, shelf) VALUES ('${TAG}-item', '${TAG} 物件', 'infra', 'infrastructure')" >/dev/null
OUT="$(cd "$BRAIN_DIR" && SMOKE_TAG="$TAG" "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { classifyAccountSwitch, accountKey, reportResourceHealth, checkResourcesHealth, collectTaskResourceRefs } from './src/lib/resource-health.js';
import { resourceHealthGate } from './src/lib/resource-health-gate.js';
const tag = process.env.SMOKE_TAG;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const noNotify = async () => null;
try {
  const key = accountKey('smokeplat', `${tag}-acc`);
  const ok = classifyAccountSwitch('switched');
  await reportResourceHealth(pool, { resource_type: 'account', resource_key: key, platform: 'smokeplat', status: ok.status, reason: null, evidence: {}, source: 'smoke', item_key: null, reported_at: null }, { notify: noNotify });
  const bad = classifyAccountSwitch('verification_required');
  if (bad.status !== 'restricted' || bad.action !== 'exit_without_verification') die('三态判据不对');
  const r = await reportResourceHealth(pool, { resource_type: 'account', resource_key: key, platform: 'smokeplat', status: bad.status, reason: '切换要身份校验', evidence: { smoke: true }, source: 'smoke', item_key: `${tag}-item`, reported_at: null }, { notify: noNotify });
  if (!r.changed || r.previous_status !== 'healthy') die(`状态变化没识别: ${JSON.stringify(r)}`);
  const refs = collectTaskResourceRefs({ account_ref: { platform: 'smokeplat', account_id: `${tag}-acc` }, device_serial: `${tag}-phone` });
  const chk = await checkResourcesHealth(pool, refs);
  if (chk.ok || chk.blocked.length !== 1 || chk.unknown.length !== 1) die(`调度前检查不对: ${JSON.stringify(chk)}`);
  const gate = await resourceHealthGate({ id: null, payload: { account_ref: key } }, { pool });
  if (!gate.blocked || !/restricted/.test(gate.summary)) die(`派发闸没挡: ${JSON.stringify(gate)}`);
  console.log(key);
} finally { await pool.end(); }
NODE
)"
KEY="$(printf '%s' "$OUT" | tail -1)"
pass "账号切换要身份校验 → restricted（立即退出不验证）；调度前检查挡住并给原因，未知资源放行"

# 3. 历史：两次状态（首报 + 变化）
HIST="$(q "SELECT string_agg(coalesce(from_status,'-') || '>' || to_status, ',' ORDER BY id) FROM resource_health_events WHERE resource_key='${KEY}'")"
[[ "$HIST" == "->healthy,healthy>restricted" ]] || fail "状态变化历史不对: $HIST"
pass "状态变化由触发器留历史：-→healthy、healthy→restricted"

# 4. 仓库物件汇总
WORST="$(q "SELECT worst_status || '|' || restricted FROM v_warehouse_item_health WHERE key='${TAG}-item'")"
[[ "$WORST" == "restricted|1" ]] || fail "仓库物件汇总不对: $WORST"
pass "仓库物件健康汇总视图：最差状态 restricted"

echo "resource-health-smoke: all passed"
