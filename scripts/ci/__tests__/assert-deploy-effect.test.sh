#!/usr/bin/env bash
# 回归测试：assert-deploy-effect.sh 部署效果确认三态判定
#
# 守护 bug（Gate3 部署回执假成功，2026-07-06 实证）：
#   deploy webhook 只凭 deploy-local.sh 退出码判 success，容器 no-op 未重启也谎报 success
#   （uptime 未变）。修法：Gate3 smoke 加"版本==预期 且 uptime 新鲜（容器真重启）"效果断言。
#
# DoD：无变更触发 deploy（容器不重启 → uptime 陈旧）时，断言必须判 NO_OP 而非 SUCCESS。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ASSERT="$REPO_ROOT/scripts/ci/assert-deploy-effect.sh"
FAIL=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# case: <名称> <health_json> <expected_version> <max_uptime> <期望verdict> <期望exit>
run_case() {
  local name="$1" json="$2" exp="$3" maxup="$4" want_verdict="$5" want_exit="$6"
  echo "$json" > "$TMP/health.json"
  local out; out=$(HEALTH_JSON_OVERRIDE="$TMP/health.json" bash "$ASSERT" "http://x" "$exp" "$maxup" 2>&1)
  local code=$?
  if echo "$out" | grep -q "$want_verdict" && [ "$code" -eq "$want_exit" ]; then
    echo "  ✅ $name → $want_verdict (exit $code)"
  else
    echo "  ❌ $name：期望 $want_verdict/exit$want_exit，实得 [$out] exit=$code"; FAIL=1
  fi
}

echo "== assert-deploy-effect 三态判定 =="
# 版本对 + uptime 新鲜 → SUCCESS
run_case "版本对+新重启" '{"version":"1.238.2","uptime_seconds":5}'      "1.238.2" 300 "SUCCESS"          0
# 版本对 + uptime 陈旧（容器没重启）→ NO_OP（DoD：无变更触发不谎报 success）
run_case "版本对+uptime陈旧" '{"version":"1.238.2","uptime_seconds":99999}' "1.238.2" 300 "NO_OP"           4
# 版本不符（跑的是旧代码）→ VERSION_MISMATCH
run_case "版本不符"       '{"version":"1.238.1","uptime_seconds":5}'      "1.238.2" 300 "VERSION_MISMATCH"  2
# 无 version 字段 / 不可达 → UNREACHABLE
run_case "无version字段"   '{"uptime_seconds":5}'                          "1.238.2" 300 "UNREACHABLE"      3
run_case "空响应"         ''                                              "1.238.2" 300 "UNREACHABLE"      3

echo ""
if [ "$FAIL" -ne 0 ]; then echo "❌ assert-deploy-effect 回归测试失败"; exit 1; fi
echo "✅ assert-deploy-effect 回归测试全部通过"
