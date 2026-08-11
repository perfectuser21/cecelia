#!/usr/bin/env bash
# Universal Map Projection Engine 路由 smoke。
# 完整数据面合同由 unified-map-api-smoke.sh 在独立 test/scratch fixture 上验证。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
CURL_EXECUTABLE="${CURL_EXECUTABLE:-$(command -v curl)}"
JQ_EXECUTABLE="${JQ_EXECUTABLE:-$(command -v jq)}"
MANIFEST_PATH="$ROOT_DIR/packages/brain/config/map-manifests/cecelia.v1.json"
INTERNAL_AUTH_HELPER="$ROOT_DIR/scripts/lib/internal-auth-token.sh"
INTERNAL_AUTH_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:-$HOME/.credentials/cecelia-internal.env}"
if [[ -z "${CECELIA_INTERNAL_TOKEN:-}" && -f "$INTERNAL_AUTH_HELPER" ]]; then
  # shellcheck source=../../../../scripts/lib/internal-auth-token.sh
  source "$INTERNAL_AUTH_HELPER"
  load_cecelia_internal_token "$INTERNAL_AUTH_ENV_FILE" || true
fi
brain_curl() {
  if [[ -n "${CECELIA_INTERNAL_TOKEN:-}" ]]; then
    "$CURL_EXECUTABLE" -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" "$@"
  else
    "$CURL_EXECUTABLE" "$@"
  fi
}
SMOKE_SCOPE="map-engine-smoke-$$"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── map-engine smoke ──"

# 1. /health 对不存在的独立 scope 也必须 fail-closed 返回 degraded envelope。
h="$(brain_curl -fsS --get "$BRAIN/api/brain/map/health" \
  --data-urlencode "scope=$SMOKE_SCOPE")" || { fail "GET /health 不可达"; h="{}"; }
# jq 变量通过 --arg 传入，不由 Bash 展开。
# shellcheck disable=SC2016
if echo "$h" | "$JQ_EXECUTABLE" -e --arg scope "$SMOKE_SCOPE" '
  .scope_key == $scope
  and .overall == "degraded"
  and .layers.manifest.status == "missing"
  and .layers.projection.status == "missing"' >/dev/null 2>&1; then
  ok "GET /health 返回 fail-closed envelope"
else
  fail "GET /health 结构异常"
fi

# 2. POST /manifests/validate 使用冻结 Manifest，避免伪造一个已过期的 schema 子集。
v="$(brain_curl -fsS -X POST "$BRAIN/api/brain/map/manifests/validate" \
  -H 'Content-Type: application/json' --data-binary "@$MANIFEST_PATH")" \
  || { fail "POST /validate 不可达"; v="{}"; }
if echo "$v" | "$JQ_EXECUTABLE" -e '.valid == true and .errors == []' >/dev/null 2>&1; then
  ok "POST /validate 返回 valid=true"
else
  fail "POST /validate 未返回 valid=true"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
if [[ $FAIL -eq 0 ]]; then
  echo "✅ 全部通过"
else
  echo "❌ 有 $FAIL 项失败"
  exit 1
fi
