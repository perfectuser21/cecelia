#!/usr/bin/env bash
# E2E smoke 验收脚本 — ops-panorama 执行全景面板
# Task: 28e7c41a-9384-405b-9e82-aa5b9871293f
# target_environment: local_api
# 用法: bash sprints/07231722-relay-28e7c41a/tests/e2e-ops-panorama.sh

set -euo pipefail

BASE="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  if [ "$result" = "$expected" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name — got: [$result] expected: [$expected]"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== ops-panorama E2E 验收 ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="
echo "    BASE=$BASE"
echo ""

# ── 1. HTTP 200 ──────────────────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE/ops-panorama" 2>/dev/null || echo "000")
check "DoD-01: HTTP 200" "$HTTP_CODE" "200"

# ── 取响应体 ─────────────────────────────────────────────────────
BODY=$(curl -s --max-time 10 "$BASE/ops-panorama" 2>/dev/null || echo "{}")

# ── 2. sampled_at 非 null ─────────────────────────────────────────
SAMPLED=$(echo "$BODY" | jq -r '.sampled_at // empty' 2>/dev/null || echo "")
check "DoD-01: sampled_at 非 null/empty" "$([ -n "$SAMPLED" ] && echo ok || echo fail)" "ok"

# ── 3. tasks.in_progress_count >= 0 ──────────────────────────────
IN_PROG=$(echo "$BODY" | jq '.tasks.in_progress_count // -1' 2>/dev/null || echo "-1")
check "DoD-02: tasks.in_progress_count >= 0" "$(awk "BEGIN{print ($IN_PROG >= 0) ? \"ok\" : \"fail\"}")" "ok"

# ── 4. vendor_dist 四键完整 ──────────────────────────────────────
VD_OK=$(echo "$BODY" | jq '(.tasks.vendor_dist | (has("claude") and has("codex") and has("grok") and has("unknown")))' 2>/dev/null || echo "false")
check "DoD-03: vendor_dist has claude/codex/grok/unknown" "$VD_OK" "true"

VD_NON_NEG=$(echo "$BODY" | jq '(.tasks.vendor_dist | [.claude, .codex, .grok, .unknown] | map(. >= 0) | all)' 2>/dev/null || echo "false")
check "DoD-03: vendor_dist values >= 0" "$VD_NON_NEG" "true"

# ── 5. host.cpu_usage_pct in [0,100] ─────────────────────────────
CPU=$(echo "$BODY" | jq '.host.cpu_usage_pct // -1' 2>/dev/null || echo "-1")
check "DoD-04: cpu_usage_pct in [0,100]" "$(awk "BEGIN{print ($CPU >= 0 && $CPU <= 100) ? \"ok\" : \"fail\"}")" "ok"

# ── 6. host.mem_used_pct in [0,100] ──────────────────────────────
MEM=$(echo "$BODY" | jq '.host.mem_used_pct // -1' 2>/dev/null || echo "-1")
check "DoD-05: mem_used_pct in [0,100]" "$(awk "BEGIN{print ($MEM >= 0 && $MEM <= 100) ? \"ok\" : \"fail\"}")" "ok"

# ── 7. processes.claude_total >= 0 ───────────────────────────────
CLAUDE_PROC=$(echo "$BODY" | jq '.processes.claude_total // -1' 2>/dev/null || echo "-1")
check "DoD-06: processes.claude_total >= 0" "$(awk "BEGIN{print ($CLAUDE_PROC >= 0) ? \"ok\" : \"fail\"}")" "ok"

CODEX_PROC=$(echo "$BODY" | jq '.processes.codex_total // -1' 2>/dev/null || echo "-1")
check "DoD-06: processes.codex_total >= 0" "$(awk "BEGIN{print ($CODEX_PROC >= 0) ? \"ok\" : \"fail\"}")" "ok"

# ── 8. llm_capacity.sentinel ─────────────────────────────────────
SENTINEL=$(echo "$BODY" | jq -r '.llm_capacity.sentinel // "null"' 2>/dev/null || echo "null")
SENTINEL_OK=$(echo "$SENTINEL" | grep -cE '^(ok|degraded|exhausted|null)$' 2>/dev/null || echo "0")
check "DoD-07: llm_capacity.sentinel valid or null" "$SENTINEL_OK" "1"

# ── 9. llm_capacity.vendors.claude.accounts length > 0（正常环境）──
if [ "$SENTINEL" != "null" ]; then
  CLAUDE_ACC=$(echo "$BODY" | jq '.llm_capacity.vendors.claude.accounts | length' 2>/dev/null || echo "0")
  check "DoD-08: claude accounts length > 0" "$([ "$CLAUDE_ACC" -gt 0 ] && echo ok || echo fail)" "ok"
else
  echo "  SKIP: DoD-08 (llm_capacity is null, skipping accounts check)"
fi

# ── 10. relay.container_count — null 时 HTTP 仍 200 ──────────────
# 已通过 DoD-01 验证，relay 字段存在即可（null 是合法值）
RELAY_FIELD=$(echo "$BODY" | jq 'has("relay")' 2>/dev/null || echo "false")
check "DoD-09: relay field exists (null is ok)" "$RELAY_FIELD" "true"

# ── 11. 无凭据字段泄露 ───────────────────────────────────────────
CRED_COUNT=$(echo "$BODY" | jq '[.. | objects | keys[]] | map(select(test("token|secret|password|apikey|api_key"; "i"))) | length' 2>/dev/null || echo "0")
check "DoD-11: 无 token/secret/password 字段" "$CRED_COUNT" "0"

# ── 12. P99 响应时间 < 2000ms（简单 5 次采样）────────────────────
MAX_MS=0
for i in 1 2 3 4 5; do
  MS=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$BASE/ops-panorama" 2>/dev/null | awk '{printf "%d", $1*1000}')
  [ "$MS" -gt "$MAX_MS" ] && MAX_MS=$MS
done
check "DoD-10: max response < 2000ms (got ${MAX_MS}ms)" "$([ $MAX_MS -lt 2000 ] && echo ok || echo fail)" "ok"

# ── 13. 回归：已有端点不受影响 ───────────────────────────────────
# 注：/api/brain/status 在 CI 环境无凭据时返回 500，属已知预期，跳过
for endpoint in "account-usage" "tick/status"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE/$endpoint" 2>/dev/null || echo "000")
  check "DoD-17: GET $endpoint 回归 200" "$CODE" "200"
done

# ── 结果 ─────────────────────────────────────────────────────────
echo ""
echo "=== 结果: PASS=${PASS} FAIL=${FAIL} ==="
if [ "$FAIL" -gt 0 ]; then
  echo "FAIL: ops-panorama E2E 验收不通过"
  exit 1
fi
echo "PASS: ops-panorama E2E 验收全部通过"
