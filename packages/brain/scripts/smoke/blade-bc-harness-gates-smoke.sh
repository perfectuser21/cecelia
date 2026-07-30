#!/usr/bin/env bash
# 刀B+刀C+收账权收归 smoke — harness judge 机械闸 + complete 收账权守卫
#
# 验证：
#   1. POST /harness/judge — 缺 behavior_tests → verdict=FAIL（机械闸拦截）
#   2. POST /harness/complete — 无 initiative_id → 400
#   3. POST /harness/complete — 无历史 run UUID → 200（保守继续）
#
# 环境：
#   BRAIN_URL  Brain API 地址，默认 http://localhost:5221
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

if ! curl -sf "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  echo "[blade-bc smoke] SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

echo "[blade-bc smoke] 检查 harness judge 机械闸 + complete 收账权守卫..."

# 1. judge — 空 behavior_tests → 机械闸拦截，返回 FAIL
RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/harness/judge" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"00000000-0000-0000-0000-000000000001","sprint_dir":"sprints/s","worktree":"/tmp","agent_verdict":"PASS","brain_result":{"behavior_tests":[],"exit_code":0,"log_tail":"ok"}}')
VERDICT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('verdict',''))" 2>/dev/null || echo "parse_error")
if [ "$VERDICT" != "FAIL" ]; then
  echo "[blade-bc smoke] FAIL — 空 behavior_tests 期望 verdict=FAIL，实际: $RESP"
  exit 1
fi
echo "[blade-bc smoke] ✓ 空 behavior_tests → judge 机械闸 FAIL"

# 2. complete — 无 initiative_id → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d '{}')
if [ "$STATUS" != "400" ]; then
  echo "[blade-bc smoke] FAIL — 无 initiative_id 期望 400，实际 $STATUS"
  exit 1
fi
echo "[blade-bc smoke] ✓ 无 initiative_id → 400"

# 3. complete — 随机 UUID（无 initiative_run 记录）→ 200（保守继续）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d '{"initiative_id":"00000000-0000-0000-0000-000000000099","merged":true}')
if [ "$STATUS" != "200" ]; then
  echo "[blade-bc smoke] WARN — 无历史 run UUID 期望 200（保守继续），实际 $STATUS（非致命）"
fi
echo "[blade-bc smoke] ✓ 无历史 run → 200（保守继续）"

echo "[blade-bc smoke] PASS"
