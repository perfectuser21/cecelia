#!/usr/bin/env bash
# smoke: codex headed tmux dispatch (B-01~B-05 合同 quick check)
# Sprint: sprints/07071654-codex-headed-dispatch
# task_id: 4cedf175-3b56-4d41-91b6-73de559f58c9
#
# 用法：bash packages/brain/scripts/smoke/b01-headed-dispatch-smoke.sh
# 依赖：Brain running at localhost:5221

set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

check() {
  local desc="$1" result="$2"
  if [ "$result" = "PASS" ]; then
    echo "✓ PASS: $desc"; PASS=$((PASS+1))
  else
    echo "✗ FAIL: $desc"; FAIL=$((FAIL+1))
  fi
}

echo "=== B-01: codex+headed 入队 → 201 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-headed-test","task_type":"harness_initiative","payload":{"executor":"codex","orchestrator":"skill-relay","mode":"headed","journey_id":"test"}}')
[[ "$STATUS" =~ ^(200|201)$ ]] && check "codex+headed 入队 → 201" "PASS" || check "codex+headed 入队 → 201" "FAIL (got $STATUS)"

echo "=== B-01: claude+headed → 400 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-headed-reject","task_type":"harness_initiative","payload":{"executor":"claude","mode":"headed","journey_id":"test"}}')
[[ "$STATUS" = "400" ]] && check "claude+headed → 400" "PASS" || check "claude+headed → 400" "FAIL (got $STATUS)"

echo "=== B-07: 源码无 \$(cat) 内联 prompt 传递 ==="
FOUND=$(grep -rn '\$(cat' packages/brain/src/ --include="*.js" 2>/dev/null | grep -i "prompt\|tmux\|relay" || true)
[ -z "$FOUND" ] && check "无 \$(cat) 内联" "PASS" || check "无 \$(cat) 内联" "FAIL"

echo "=== B-08: 源码无账号池逻辑 ==="
POOL=$(grep -rn "accountPool\|account_pool\|rotateAccount" packages/brain/src/ --include="*.js" 2>/dev/null || true)
[ -z "$POOL" ] && check "无账号池逻辑" "PASS" || check "无账号池逻辑" "FAIL"

echo "=== migration 316 存在 ==="
[ -f "packages/brain/migrations/316_initiative_runs_tmux_killed_at.sql" ] && check "migration 316 存在" "PASS" || check "migration 316 存在" "FAIL"

echo ""
echo "=== Smoke 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
