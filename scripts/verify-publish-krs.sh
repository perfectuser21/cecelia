#!/usr/bin/env bash
# verify-publish-krs.sh
# 验收发布 KR 达标情况（数据来自 publish_success_daily 近7日快照）
#   KR1 — 非微信平台近7日平均发布成功率 ≥ 90%
#   KR2 — 微信平台近7日平均发布成功率 ≥ 90%
#
# 支持两种模式（自动选择）：
#   BRAIN_URL 已设置 → 调用 Brain REST API（CI 推荐模式）
#   BRAIN_URL 未设置 → docker exec ${DB_CONTAINER} psql（本地开发模式）
#
# 用法：
#   bash scripts/verify-publish-krs.sh
#   BRAIN_URL=http://localhost:5221 bash scripts/verify-publish-krs.sh
#
# exit 0 = KR1 + KR2 均达标
# exit 1 = 至少一项未达标，或无法连接数据源

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-}"
DB_CONTAINER="${DB_CONTAINER:-cecelia-postgres}"
DB_USER="${DB_USER:-cecelia}"
DB_NAME="${DB_NAME:-cecelia}"
THRESHOLD="${THRESHOLD:-90}"
DAYS=7

log()  { echo "[verify-krs] $(date '+%H:%M:%S') $*"; }
fail() { echo "[verify-krs] FAIL: $*" >&2; exit 1; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────

check_deps_api() {
  for cmd in curl jq awk; do
    command -v "$cmd" &>/dev/null || fail "缺少依赖: $cmd"
  done
  curl -sf --max-time 5 "${BRAIN_URL}/api/brain/health" -o /dev/null 2>/dev/null \
    || fail "Brain API 不可达: ${BRAIN_URL} — 请确认 Brain 已启动或 BRAIN_URL 配置正确"
}

check_deps_docker() {
  for cmd in docker awk; do
    command -v "$cmd" &>/dev/null || fail "缺少依赖: $cmd"
  done
  docker ps --filter "name=^${DB_CONTAINER}$" --format "{{.Names}}" \
    | grep -q "^${DB_CONTAINER}$" \
    || fail "PostgreSQL 容器未运行: ${DB_CONTAINER}（可设置 BRAIN_URL 改用 API 模式）"
}

# ── Brain API 模式 ────────────────────────────────────────────────────────────

api_avg_rate() {
  local extra_param="${1:-}"
  local url="${BRAIN_URL}/api/brain/publish/success-rate?days=${DAYS}${extra_param}"
  local data
  data=$(curl -sf --max-time 10 "$url") || fail "API 调用失败: $url"
  # 返回所有有数据的日期的平均成功率；无数据时返回 0
  echo "$data" | jq \
    '[.[] | select(.success_rate != null) | .success_rate]
     | if length > 0 then (add / length | . * 100 | round / 100) else 0 end'
}

# ── Docker psql 模式 ──────────────────────────────────────────────────────────

psql_query() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$1" \
    2>/dev/null | xargs
}

psql_avg_rate() {
  local where_extra="$1"
  psql_query "
    SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0)
    FROM publish_success_daily
    WHERE date >= CURRENT_DATE - INTERVAL '$((DAYS - 1)) days'
      ${where_extra}
      AND success_rate IS NOT NULL;
  "
}

# ── 主流程 ────────────────────────────────────────────────────────────────────

main() {
  local kr1_rate kr2_rate

  if [[ -n "$BRAIN_URL" ]]; then
    log "模式: Brain API → ${BRAIN_URL}"
    check_deps_api
    # KR1: 全平台聚合（API 无 exclude 过滤，用整体均值做 KR1 代理）
    kr1_rate=$(api_avg_rate "")
    # KR2: 微信平台
    kr2_rate=$(api_avg_rate "&platform=wechat")
  else
    log "模式: Docker psql → ${DB_CONTAINER}"
    check_deps_docker
    kr1_rate=$(psql_avg_rate "AND platform != 'wechat'")
    kr2_rate=$(psql_avg_rate "AND platform = 'wechat'")
  fi

  echo ""
  echo "══════════════════════════════════════════════════════"
  echo " 发布 KR 验收报告（近 ${DAYS} 日 | 阈值: ≥${THRESHOLD}%）"
  echo "══════════════════════════════════════════════════════"
  printf " KR1 (多平台)  : %s%%\n" "$kr1_rate"
  printf " KR2 (微信)    : %s%%\n" "$kr2_rate"
  echo "──────────────────────────────────────────────────────"

  local pass=true
  local kr1_ok kr2_ok

  kr1_ok=$(awk "BEGIN { print ($kr1_rate >= $THRESHOLD) ? \"yes\" : \"no\" }")
  kr2_ok=$(awk "BEGIN { print ($kr2_rate >= $THRESHOLD) ? \"yes\" : \"no\" }")

  if [[ "$kr1_ok" == "yes" ]]; then
    printf " KR1 : ✅ PASS (%s%% ≥ %s%%)\n" "$kr1_rate" "$THRESHOLD"
  else
    printf " KR1 : ❌ FAIL (%s%% < %s%%)\n" "$kr1_rate" "$THRESHOLD"
    pass=false
  fi

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
    echo " ❌ KR 验收未达标 — publisher 改动被阻止"
    echo "══════════════════════════════════════════════════════"
    exit 1
  fi
}

main "$@"
