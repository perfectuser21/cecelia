#!/usr/bin/env bash
# e2e-nightly.sh — smoke/e2e/ 池 nightly 全量运行器
#
# 功能：
#   1. 全量跑 scripts/smoke/e2e/*.sh（传 BRAIN_URL=staging 5222）
#   2. 失败发 Bark 晨报
#   3. 结果写 Brain KV (smoke-nightly-last-run)
#
# 用法：
#   bash scripts/smoke/e2e-nightly.sh [BRAIN_URL]
#   BRAIN_URL 默认 http://localhost:5221（KV 写入）
#   STAGING_URL 默认 http://localhost:5222（e2e 脚本入参）
#
# 系统域 LaunchDaemon: /Library/LaunchDaemons/com.cecelia.smoke-nightly.plist

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
E2E_DIR="$SCRIPT_DIR/e2e"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
STAGING_URL="${STAGING_URL:-http://localhost:5222}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TOTAL=0
PASSED=0
FAILED=0
declare -a FAIL_NAMES=()

echo "======================================================"
echo "smoke/e2e/ nightly — $STARTED_AT"
echo "Brain KV: $BRAIN_URL  |  Staging: $STAGING_URL"
echo "======================================================"

# ── 加载 Bark token（bark.env 路径兼容本机/CI）───────────────────────
if [[ -f "$HOME/.credentials/bark.env" ]]; then
  source "$HOME/.credentials/bark.env" 2>/dev/null || true
fi

send_bark_alert() {
  local msg="$1"
  if [[ -z "${BARK_TOKEN:-}" ]]; then
    info "未配 BARK_TOKEN，跳过 Bark 推送"
    return 0
  fi
  local title="🔴 Smoke E2E Nightly"
  local body
  body="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$msg" 2>/dev/null || echo "$msg")"
  curl -sf --max-time 10 \
    "https://api.day.app/${BARK_TOKEN}/${title}/${body}?group=smoke-nightly&level=critical" \
    >/dev/null 2>&1 && info "Bark 已推送" || info "Bark 推送失败（不阻塞）"
}

# ── 逐条跑 e2e/*.sh ──────────────────────────────────────────────────
for script in "$E2E_DIR"/*.sh; do
  [[ -f "$script" ]] || continue
  name="$(basename "$script")"
  TOTAL=$((TOTAL + 1))
  info "运行: $name"
  if BRAIN_URL="$STAGING_URL" DATABASE_URL="${DATABASE_URL:-}" bash "$script" 2>&1; then
    pass "$name"
    PASSED=$((PASSED + 1))
  else
    fail "$name"
    FAILED=$((FAILED + 1))
    FAIL_NAMES+=("$name")
  fi
  echo ""
done

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATUS="green"
[[ $FAILED -gt 0 ]] && STATUS="red"

echo "======================================================"
echo "nightly 完成: PASS=$PASSED  FAIL=$FAILED  TOTAL=$TOTAL  STATUS=$STATUS"
echo "======================================================"

# ── 写 Brain KV ──────────────────────────────────────────────────────
KV_PAYLOAD="$(cat <<JSON
{
  "status": "$STATUS",
  "passed": $PASSED,
  "failed": $FAILED,
  "total": $TOTAL,
  "failed_scripts": $(printf '%s\n' "${FAIL_NAMES[@]+"${FAIL_NAMES[@]}"}" | jq -R . | jq -s . 2>/dev/null || echo "[]"),
  "started_at": "$STARTED_AT",
  "finished_at": "$FINISHED_AT",
  "staging_url": "$STAGING_URL"
}
JSON
)"

if curl -sf --max-time 10 \
    -X POST "$BRAIN_URL/api/brain/kv/smoke-nightly-last-run" \
    -H "Content-Type: application/json" \
    -d "$KV_PAYLOAD" >/dev/null 2>&1; then
  info "Brain KV 写入成功 (smoke-nightly-last-run)"
else
  info "Brain KV 写入失败（Brain 可能未运行）"
fi

# ── Bark 晨报（仅失败时发）───────────────────────────────────────────
if [[ $FAILED -gt 0 ]]; then
  FAIL_LIST="$(IFS=,; echo "${FAIL_NAMES[*]}")"
  send_bark_alert "staging smoke nightly: ${FAILED}/${TOTAL} 失败 — ${FAIL_LIST}"
  exit 1
fi

echo "✅ 全绿"
exit 0
