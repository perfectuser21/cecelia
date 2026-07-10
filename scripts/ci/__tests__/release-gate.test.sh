#!/usr/bin/env bash
# 回归测试：release-gate-check.sh 刀C Release Gate 三态判定
#
# 守护：promote-dashboard / brain 部署前必须有最近 nightly 绿证据；
#       无证据或证据超过 HOURS_WINDOW → 硬红阻断。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GATE="$REPO_ROOT/scripts/ci/release-gate-check.sh"
FAIL=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 生成距 NOW 偏移 N 小时的 ISO 时间戳
hours_ago() {
  local h="$1"
  if date -v -${h}H +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    # macOS
    date -v -${h}H +"%Y-%m-%dT%H:%M:%SZ"
  else
    # Linux
    date -u -d "${h} hours ago" +"%Y-%m-%dT%H:%M:%SZ"
  fi
}

# run_case <name> <fixture_json> <expected_exit>
run_case() {
  local name="$1" json="$2" want_exit="$3"
  echo "$json" > "$TMP/fixture.json"
  local out code
  out=$(RELEASE_GATE_FIXTURE_JSON="$TMP/fixture.json" \
        GITHUB_REPOSITORY="test/repo" \
        bash "$GATE" 24 2>&1)
  code=$?
  if [ "$code" -eq "$want_exit" ]; then
    echo "  ✅ $name → exit $code"
  else
    echo "  ❌ ${name}：期望 exit${want_exit}，实得 exit=$code"
    echo "     output: $out"
    FAIL=1
  fi
}

echo "== release-gate-check 三态判定 =="

# Case 1: 近期有成功 run（2h 前）→ 通过（exit 0）
RECENT_OK=$(hours_ago 2)
run_case "近期成功run(2h前)" \
  "{\"workflow_runs\":[{\"id\":111,\"status\":\"completed\",\"conclusion\":\"success\",\"created_at\":\"$RECENT_OK\",\"head_branch\":\"main\"}]}" \
  0

# Case 2: 无任何 run → 失败（exit 1）
run_case "无 run 记录" \
  '{"workflow_runs":[]}' \
  1

# Case 3: 只有失败 run → 失败（exit 1）
RECENT_FAIL=$(hours_ago 3)
run_case "只有失败run" \
  "{\"workflow_runs\":[{\"id\":222,\"status\":\"completed\",\"conclusion\":\"failure\",\"created_at\":\"$RECENT_FAIL\",\"head_branch\":\"main\"}]}" \
  1

# Case 4: 成功 run 但已过 HOURS_WINDOW（30h 前，窗口 24h）→ 失败（exit 1）
OLD=$(hours_ago 30)
run_case "成功run但太旧(30h>24h)" \
  "{\"workflow_runs\":[{\"id\":333,\"status\":\"completed\",\"conclusion\":\"success\",\"created_at\":\"$OLD\",\"head_branch\":\"main\"}]}" \
  1

# Case 5: 最新是失败但还有较新的成功 run → 通过（exit 0）
RECENT_FAIL2=$(hours_ago 1)
RECENT_OK2=$(hours_ago 5)
run_case "最新失败但有近期成功run" \
  "{\"workflow_runs\":[{\"id\":444,\"status\":\"completed\",\"conclusion\":\"failure\",\"created_at\":\"$RECENT_FAIL2\",\"head_branch\":\"main\"},{\"id\":445,\"status\":\"completed\",\"conclusion\":\"success\",\"created_at\":\"$RECENT_OK2\",\"head_branch\":\"main\"}]}" \
  0

# Case 6: fixture JSON 格式错误 → 失败（exit 1，不 crash）
run_case "无效JSON" \
  'not-valid-json' \
  1

echo ""
if [ "$FAIL" -ne 0 ]; then echo "❌ release-gate 回归测试失败"; exit 1; fi
echo "✅ release-gate 回归测试全部通过"
