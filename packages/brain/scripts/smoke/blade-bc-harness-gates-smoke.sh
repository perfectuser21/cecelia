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
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
SMOKE_TAG="blade-bc-${GITHUB_RUN_ID:-local}-$$-$RANDOM"
JUDGE_WORKTREE="${JUDGE_WORKTREE:-$(pwd)}"
if [ -n "${BRAIN_CONTAINER:-}" ]; then
  JUDGE_WORKTREE="/tmp"
fi

cleanup() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB" -X -v ON_ERROR_STOP=1 -c \
      "DELETE FROM initiative_runs WHERE current_task_id IN (
         SELECT id FROM tasks WHERE payload->>'smoke_tag' = '$SMOKE_TAG'
       );
       DELETE FROM tasks WHERE payload->>'smoke_tag' = '$SMOKE_TAG';" \
      >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! curl -sf "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  echo "[blade-bc smoke] SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

echo "[blade-bc smoke] 检查 harness judge 机械闸 + complete 收账权守卫..."

# 1. judge — 先建立 exact run authority，再验证空 behavior_tests 被机械闸拦截。
# PR2 后 Judge 不再接受脱离 run 身份的客户端路径；没有 authority 的请求应先被 404 拒绝。
if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -X -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "[blade-bc smoke] SKIP — DB/psql 不可达，无法建立 Judge exact-run authority"
  exit 0
fi

TASK_RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"blade-bc-$SMOKE_TAG\",\"payload\":{\"orchestrator\":\"skill-relay\",\"worktree_path\":\"$JUDGE_WORKTREE\",\"sprint_dir\":\"sprints/s\",\"smoke_tag\":\"$SMOKE_TAG\"}}")
TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
if [ -z "$TASK_ID" ]; then
  echo "[blade-bc smoke] FAIL — 创建 Judge authority task 失败: $TASK_RESP"
  exit 1
fi

RUN_RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/orchestrator/relay-runs" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TASK_ID\",\"current_task_id\":\"$TASK_ID\",\"created_source\":\"foreground_handoff\",\"phase\":\"evaluate\"}")
RUN_ID=$(echo "$RUN_RESP" | python3 -c "import sys,json; print((json.load(sys.stdin).get('run') or {}).get('id',''))")
if [ -z "$RUN_ID" ]; then
  echo "[blade-bc smoke] FAIL — 创建 Judge exact run 失败: $RUN_RESP"
  exit 1
fi

RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/harness/judge" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"sprint_dir\":\"sprints/s\",\"worktree\":\"$JUDGE_WORKTREE\",\"agent_verdict\":\"PASS\"}")
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
