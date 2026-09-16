#!/usr/bin/env bash
# skill-ledger-reconcile-smoke — 真库火：nightly A5/A6 两条守夜断言必须真能报红。
#
# 立此 smoke 的理由（2026-09-16 实证）：系统里原有两道守卫都没叫——
# map-projection-refresh 只比「headers vs 投影」，两边同旧即判"不漂移"正确跳过；
# run-all-scans.sh 的哨兵只改 API 返回值不告警。结果扫描链断 6 天无人知，
# 13 个任务积压 + 熔断 OPEN。没亲眼见它报红过的守卫不算守卫，故本 smoke
# 只做一件事：把数据弄脏，逼这两条断言红给我看。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG="ledger-$$"

cleanup() {
  q "DELETE FROM ops_skills       WHERE name LIKE '${TAG}%'"        >/dev/null 2>&1 || true
  q "DELETE FROM skill_registry   WHERE name LIKE '${TAG}%'"        >/dev/null 2>&1 || true
  q "DELETE FROM skill_drift_alerts WHERE skill_name = '__skill_ledger_count__'" >/dev/null 2>&1 || true
  q "DELETE FROM fact_snapshot_headers WHERE repo LIKE '${TAG}%'"   >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 断言求值器：注入真库 pool 跑 buildNightlyAssertions，打印指定 key 的 ok/detail
run_assertion() {
  local key="$1"
  "$NODE" --input-type=module -e "
    import pg from 'pg';
    import { buildNightlyAssertions } from '${BRAIN_DIR}/src/promise-map-nightly.js';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const rs = await buildNightlyAssertions(pool);
    const r = rs.find(x => x.key === '${key}');
    console.log(JSON.stringify({ ok: r?.ok, detail: r?.detail ?? '' }));
    await pool.end();
  "
}

# ── 1. A5：快照停更 >24h 必须报红并点名 repo ───────────────
q "INSERT INTO fact_snapshot_headers (kind,repo,source_revision,scanner_version,scanned_at,row_count)
   VALUES ('api','${TAG}-stale','deadbeef','smoke', NOW() - INTERVAL '200 hours', 1)
   ON CONFLICT (kind,repo) DO UPDATE SET scanned_at = EXCLUDED.scanned_at" >/dev/null
A5="$(run_assertion fact_snapshot_freshness)"
echo "$A5" | grep -q '"ok":false' || fail "A5 未对 200h 停更快照报红: $A5"
echo "$A5" | grep -q "${TAG}-stale"  || fail "A5 报红但未点名停更 repo: $A5"
pass "A5 事实快照新鲜度：停更 200h 真报红且点名 repo（proven-to-fire）"

q "DELETE FROM fact_snapshot_headers WHERE repo LIKE '${TAG}%'" >/dev/null

# ── 2. A6：账本与运行舱投影分叉必须报红 + 落 skill_drift_alerts ──
q "INSERT INTO skill_registry (name,description,location,status)
   VALUES ('${TAG}-a','smoke','openclaw','active'),
          ('${TAG}-b','smoke','openclaw','active')" >/dev/null
q "INSERT INTO ops_skills (source,name,used_by)
   VALUES ('openclaw','${TAG}-a','[]'::jsonb)" >/dev/null
A6="$(run_assertion skill_ledger_consistency)"
echo "$A6" | grep -q '"ok":false' || fail "A6 未对 registry/ops_skills 分叉报红: $A6"
pass "A6 skill 账本一致性：账实分叉真报红（proven-to-fire）"

DRIFT="$(q "SELECT count(*) FROM skill_drift_alerts WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE")"
[[ "$DRIFT" == "1" ]] || fail "A6 报红但未落账 skill_drift_alerts，got=$DRIFT"
pass "A6 分叉落账 skill_drift_alerts（复用 2026-07-17 后停更的表，未新建）"

# 重跑幂等：UNIQUE(skill_name,drift_date) 保证每天仍只有一条
run_assertion skill_ledger_consistency >/dev/null
DRIFT2="$(q "SELECT count(*) FROM skill_drift_alerts WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE")"
[[ "$DRIFT2" == "1" ]] || fail "重跑后 drift_alerts 重复写入，got=$DRIFT2"
pass "A6 重跑幂等：当日仍只一条告警"

# ── 3. pushSkillRegistry 指纹：内容变更后指纹必须失配（触发重推）──
q "UPDATE skill_registry
      SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('pushed_digest',
          md5(coalesce(name,'')||'|'||coalesce(description,'')||'|'||coalesce(status,'')||'|'||coalesce(location,'')))
    WHERE name='${TAG}-a'" >/dev/null
STALE_BEFORE="$(q "SELECT count(*) FROM skill_registry WHERE name='${TAG}-a'
  AND (metadata->>'pushed_digest') IS DISTINCT FROM
      md5(coalesce(name,'')||'|'||coalesce(description,'')||'|'||coalesce(status,'')||'|'||coalesce(location,''))")"
[[ "$STALE_BEFORE" == "0" ]] || fail "指纹刚写入就失配，判据有误"
pass "pushSkillRegistry 指纹：内容未变则不重推（防 Notion 限流）"

q "UPDATE skill_registry SET description='改过了' WHERE name='${TAG}-a'" >/dev/null
STALE_AFTER="$(q "SELECT count(*) FROM skill_registry WHERE name='${TAG}-a'
  AND (metadata->>'pushed_digest') IS DISTINCT FROM
      md5(coalesce(name,'')||'|'||coalesce(description,'')||'|'||coalesce(status,'')||'|'||coalesce(location,''))")"
[[ "$STALE_AFTER" == "1" ]] || fail "description 改了指纹却仍匹配——insert-only 缺陷会复发"
pass "pushSkillRegistry 指纹：description 变更后失配，下轮必重推（回归守卫）"

echo "ALL PASS: skill-ledger-reconcile"
