#!/usr/bin/env bash
# verify-publish-krs.sh
# 验收 KR1（多平台发布成功率≥90%）+ KR2（微信发布成功率≥90%）
# 数据来源：publish_success_daily 表近7日快照
#
# 用法：
#   bash scripts/verify-publish-krs.sh
#
# exit 0 = 双 KR 均达标
# exit 1 = 至少一项 KR 不达标或数据不足

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────────
DB_CONTAINER="${DB_CONTAINER:-cecelia-postgres}"
DB_USER="${DB_USER:-cecelia}"
DB_NAME="${DB_NAME:-cecelia}"
THRESHOLD=90
DAYS=7

log()  { echo "[verify-krs] $(date '+%H:%M:%S') $*"; }
fail() { echo "[verify-krs] ERROR: $*" >&2; exit 1; }

# ─── 依赖检查 ─────────────────────────────────────────────────────────────────
check_deps() {
  command -v docker &>/dev/null || fail "缺少依赖: docker"
  docker ps --filter "name=^${DB_CONTAINER}$" --format "{{.Names}}" \
    | grep -q "^${DB_CONTAINER}$" \
    || fail "PostgreSQL 容器未运行: $DB_CONTAINER"
}

# ─── DB 查询 ──────────────────────────────────────────────────────────────────
db_query() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$1" 2>/dev/null | xargs
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
  check_deps

  log "查询 publish_success_daily 近 ${DAYS} 日数据..."

  # KR1: 非微信平台平均成功率
  KR1_RATE=$(db_query "
    SELECT COALESCE(ROUND(AVG(success_rate), 2)::text, 'NULL')
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '${DAYS} days'
      AND platform != 'wechat'
      AND success_rate IS NOT NULL;
  ")

  # KR2: 微信平台平均成功率
  KR2_RATE=$(db_query "
    SELECT COALESCE(ROUND(AVG(success_rate), 2)::text, 'NULL')
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '${DAYS} days'
      AND platform = 'wechat'
      AND success_rate IS NOT NULL;
  ")

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " KR 验收报告（近 ${DAYS} 日 | 阈值: ${THRESHOLD}%）"
  echo "════════════════════════════════════════════════════════"
  printf " KR1（多平台，非微信）: %s%%\n" "$KR1_RATE"
  printf " KR2（微信）           : %s%%\n" "$KR2_RATE"
  echo "════════════════════════════════════════════════════════"

  local kr1_pass=false kr2_pass=false

  # 数据存在性检查
  if [[ "$KR1_RATE" == "NULL" || -z "$KR1_RATE" ]]; then
    echo " ⚠️  KR1: 近 ${DAYS} 日无多平台数据，视为不达标"
  else
    if awk "BEGIN { exit !($KR1_RATE >= $THRESHOLD) }"; then
      echo " ✅ KR1 达标: $KR1_RATE% >= ${THRESHOLD}%"
      kr1_pass=true
    else
      echo " ❌ KR1 未达标: $KR1_RATE% < ${THRESHOLD}%"
    fi
  fi

  if [[ "$KR2_RATE" == "NULL" || -z "$KR2_RATE" ]]; then
    echo " ⚠️  KR2: 近 ${DAYS} 日无微信数据，视为不达标"
  else
    if awk "BEGIN { exit !($KR2_RATE >= $THRESHOLD) }"; then
      echo " ✅ KR2 达标: $KR2_RATE% >= ${THRESHOLD}%"
      kr2_pass=true
    else
      echo " ❌ KR2 未达标: $KR2_RATE% < ${THRESHOLD}%"
    fi
  fi

  echo "════════════════════════════════════════════════════════"

  if [[ "$kr1_pass" == "true" && "$kr2_pass" == "true" ]]; then
    echo " ✅ KR1=$KR1_RATE% KR2=$KR2_RATE% PASS"
    echo "════════════════════════════════════════════════════════"
    exit 0
  else
    echo " ❌ 验收未通过 — 请检查发布成功率"
    echo "════════════════════════════════════════════════════════"
    exit 1
  fi
}

main "$@"
