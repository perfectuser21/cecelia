#!/usr/bin/env bash
# verify-publish-krs.sh
# 验证发布 KR 达标情况：
#   KR1 — 非微信平台近7日平均发布成功率 ≥ 90%
#   KR2 — 微信平台近7日平均发布成功率 ≥ 90%
#
# 用法：bash scripts/verify-publish-krs.sh
# exit 0 = 全部达标，exit 1 = 未达标

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-cecelia-postgres}"
DB_USER="${DB_USER:-cecelia}"
DB_NAME="${DB_NAME:-cecelia}"
THRESHOLD=90

log()  { echo "[verify-krs] $(date '+%H:%M:%S') $*"; }
fail() { echo "[verify-krs] FAIL: $*" >&2; exit 1; }

# ── 前置检查 ─────────────────────────────────────────────────────────────────

check_deps() {
  for cmd in docker jq awk; do
    command -v "$cmd" &>/dev/null || fail "缺少依赖: $cmd"
  done
}

check_db() {
  docker ps --filter "name=^${DB_CONTAINER}$" --format "{{.Names}}" \
    | grep -q "^${DB_CONTAINER}$" \
    || fail "PostgreSQL 容器未运行: $DB_CONTAINER"
}

psql_query() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$1" \
    | xargs  # 去除前后空白
}

# ── 查询 ─────────────────────────────────────────────────────────────────────

query_kr1() {
  # 近7日所有非微信平台的平均成功率（忽略 NULL 行）
  psql_query "
    SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0)
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '6 days'
      AND platform != 'wechat'
      AND success_rate IS NOT NULL;
  "
}

query_kr2() {
  # 近7日微信平台的平均成功率
  psql_query "
    SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0)
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '6 days'
      AND platform = 'wechat'
      AND success_rate IS NOT NULL;
  "
}

query_row_count() {
  local platform_filter="$1"
  psql_query "
    SELECT COUNT(*)
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '6 days'
      ${platform_filter};
  "
}

# ── 主流程 ────────────────────────────────────────────────────────────────────

main() {
  check_deps
  check_db

  log "查询 publish_success_daily 近7日数据..."

  local kr1_rate kr2_rate
  kr1_rate=$(query_kr1)
  kr2_rate=$(query_kr2)

  local kr1_rows kr2_rows
  kr1_rows=$(query_row_count "AND platform != 'wechat'")
  kr2_rows=$(query_row_count "AND platform = 'wechat'")

  echo ""
  echo "══════════════════════════════════════════════════════"
  echo " 发布 KR 验收报告"
  echo "══════════════════════════════════════════════════════"
  printf " KR1 (多平台)  : %s%% (样本: %s 行，阈值: ≥%s%%)\n" \
    "$kr1_rate" "$kr1_rows" "$THRESHOLD"
  printf " KR2 (微信)    : %s%% (样本: %s 行，阈值: ≥%s%%)\n" \
    "$kr2_rate" "$kr2_rows" "$THRESHOLD"
  echo "──────────────────────────────────────────────────────"

  local pass=true

  # KR1 判断
  local kr1_ok
  kr1_ok=$(awk "BEGIN { print ($kr1_rate >= $THRESHOLD) ? \"yes\" : \"no\" }")
  if [[ "$kr1_ok" == "yes" ]]; then
    printf " KR1 : ✅ PASS (%s%% ≥ %s%%)\n" "$kr1_rate" "$THRESHOLD"
  else
    printf " KR1 : ❌ FAIL (%s%% < %s%%)\n" "$kr1_rate" "$THRESHOLD"
    pass=false
  fi

  # KR2 判断
  local kr2_ok
  kr2_ok=$(awk "BEGIN { print ($kr2_rate >= $THRESHOLD) ? \"yes\" : \"no\" }")
  if [[ "$kr2_ok" == "yes" ]]; then
    printf " KR2 : ✅ PASS (%s%% ≥ %s%%)\n" "$kr2_rate" "$THRESHOLD"
  else
    printf " KR2 : ❌ FAIL (%s%% < %s%%)\n" "$kr2_rate" "$THRESHOLD"
    pass=false
  fi

  echo "══════════════════════════════════════════════════════"

  if [[ "$pass" == "true" ]]; then
    echo " ✅ KR1=${kr1_rate}% KR2=${kr2_rate}% PASS"
    echo "══════════════════════════════════════════════════════"
    exit 0
  else
    echo " ❌ KR 验收未达标"
    echo "══════════════════════════════════════════════════════"
    exit 1
  fi
}

main "$@"
