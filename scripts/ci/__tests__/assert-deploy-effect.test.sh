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
    echo "  ❌ ${name}：期望 $want_verdict/exit${want_exit}，实得 [$out] exit=$code"; FAIL=1
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
echo "== assert-deploy-effect 等待预算重试语义（Gate3 假红根治，2026-07-15 实证）=="
# 背景：Gate3 部署 ~7min > workflow 等待步 300s，断言一锤子判定旧版本 → VERSION_MISMATCH 假红。
# 修法：第 4 参 wait_budget_s>0 时在预算内重试（间隔 RETRY_INTERVAL_S env，默认 15s）。

# R1: 预算内版本追上 → SUCCESS exit 0
F="$TMP/health-r1.json"
echo '{"version":"9.9.8","uptime_seconds":5000}' > "$F"
( sleep 2; echo '{"version":"9.9.9","uptime_seconds":10}' > "$F" ) &
OUT=$(HEALTH_JSON_OVERRIDE="$F" RETRY_INTERVAL_S=1 bash "$ASSERT" "http://x" "9.9.9" 300 20 2>&1)
CODE=$?
wait
if echo "$OUT" | grep -q "SUCCESS" && [ "$CODE" -eq 0 ]; then
  echo "  ✅ R1 预算内追上→SUCCESS (exit $CODE)"
else
  echo "  ❌ R1 预算内追上：期望 SUCCESS/exit0，实得 [$OUT] exit=$CODE"; FAIL=1
fi

# R2: 预算耗尽仍旧版 → VERSION_MISMATCH exit 2
F2="$TMP/health-r2.json"
echo '{"version":"9.9.8","uptime_seconds":5000}' > "$F2"
OUT=$(HEALTH_JSON_OVERRIDE="$F2" RETRY_INTERVAL_S=1 bash "$ASSERT" "http://x" "9.9.9" 300 2 2>&1)
CODE=$?
if echo "$OUT" | grep -q "VERSION_MISMATCH" && [ "$CODE" -eq 2 ]; then
  echo "  ✅ R2 预算耗尽仍旧版→VERSION_MISMATCH (exit $CODE)"
else
  echo "  ❌ R2 预算耗尽：期望 VERSION_MISMATCH/exit2，实得 [$OUT] exit=$CODE"; FAIL=1
fi

# R3: 不带第 4 参 = 现行为一锤子判定（不等待，整个调用 <3s）
F3="$TMP/health-r3.json"
echo '{"version":"9.9.8","uptime_seconds":5000}' > "$F3"
T0=$SECONDS
OUT=$(HEALTH_JSON_OVERRIDE="$F3" bash "$ASSERT" "http://x" "9.9.9" 300 2>&1)
CODE=$?
ELAPSED=$(( SECONDS - T0 ))
if echo "$OUT" | grep -q "VERSION_MISMATCH" && [ "$CODE" -eq 2 ] && [ "$ELAPSED" -lt 3 ]; then
  echo "  ✅ R3 不带第4参=现行为一锤 (exit $CODE, ${ELAPSED}s)"
else
  echo "  ❌ R3 兼容性：期望立即 VERSION_MISMATCH/exit2/<3s，实得 [$OUT] exit=$CODE elapsed=${ELAPSED}s"; FAIL=1
fi

echo ""
if [ "$FAIL" -ne 0 ]; then echo "❌ assert-deploy-effect 回归测试失败"; exit 1; fi
echo "✅ assert-deploy-effect 回归测试全部通过"
