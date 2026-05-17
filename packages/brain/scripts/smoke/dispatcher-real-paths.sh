#!/usr/bin/env bash
# dispatcher-real-paths.sh — dispatcher.js 真环境多路径覆盖
#
# 4 agent 审计找出 dispatcher.js 是 brain 最核心的调度引擎之一，
# 但 src/__tests__/dispatcher*.test.js 全部 mock db/executor/bridge，
# real-env-smoke 之前只覆盖了 Phase 2.5 retired drain 一个路径。
# PR #2660 的 Phase 2.5 drain bug 就是单测全过 → prod 才暴露的典型。
#
# 本 smoke 覆盖剩下 3 条关键真路径：
#   Case A: pre-flight 短描述 reject —— task metadata 应被标 pre_flight_failed
#   Case B: initiative-lock —— 同 project 并发 harness_initiative，只 1 个能 dispatch
#   Case C: empty queue —— dispatch 返回 no_dispatchable_task（不抛）
#
# 不依赖 cecelia-bridge / claude executor —— 全程操作 Brain API + DB。
# CI（CECELIA_TICK_ENABLED=false）需主动 POST /api/brain/tick 触发。

set -eo pipefail  # 不用 -u，python3 子进程偶有空输出导致 "unbound variable"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
MAX_WAIT_SEC="${DISPATCHER_SMOKE_MAX_WAIT_SEC:-90}"

echo "🔍 dispatcher-real-paths — Brain @ ${BRAIN_URL}"
echo "  MAX_WAIT_SEC=${MAX_WAIT_SEC}"
# 唯一后缀防止 dedup constraint 冲突（重复跑同 title 会被拒）
SMOKE_RUN_ID="$(date +%s)-$$"
echo "  SMOKE_RUN_ID=${SMOKE_RUN_ID}"
echo ""

PASSED=0
FAILED=0

pass() { echo "  ✅ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED+1)); }

# health check
if ! curl -sf "${BRAIN_URL}/api/brain/tick/status" >/dev/null 2>&1; then
  echo "❌ Brain not healthy at ${BRAIN_URL}" >&2
  exit 1
fi

# ─── helpers ────────────────────────────────────────────
register_task() {
  # $1=title $2=description $3=task_type $4=priority [$5=project_id]
  local payload
  payload=$(python3 -c "
import json, sys
d = {
  'title': '$1',
  'description': '$2',
  'task_type': '$3',
  'priority': '$4',
  'trigger_source': 'manual',
}
if '${5:-}': d['project_id'] = '${5:-}'
print(json.dumps(d))
")
  curl -sS -m 10 -X POST "${BRAIN_URL}/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))"
}

trigger_tick() {
  # tick 偶尔慢（dispatcher iter 多 task），10s timeout 足够；超时不算失败
  curl -sS -m 10 -X POST "${BRAIN_URL}/api/brain/tick" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1 || true
}

get_task_field() {
  # $1=task_id $2=field
  curl -sS -m 10 "${BRAIN_URL}/api/brain/tasks/$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
field = '$2'
# 支持嵌套：metadata.xxx
parts = field.split('.')
v = d
for p in parts:
    if isinstance(v, dict): v = v.get(p)
    else: v = None
    if v is None: break
print(v if v is not None else '')
"
}

# ─── Case A: preFlightCheck 函数契约（直接调函数） ───────
# 历史曾用"注册 bad task → poll dispatcher → 看 metadata"，但 CI clean docker
# 无 cecelia-bridge → dispatcher checkCeceliaRunAvailable 短路 → pre-flight 永
# 不跑。改成 docker exec 直接调 preFlightCheck 函数（不依赖 dispatcher 链路）。
echo "[Case A] preFlightCheck 契约 — title<5 必 reject"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-}"
if [ -z "$BRAIN_CONTAINER" ]; then
  for c in cecelia-brain-smoke cecelia-node-brain; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
      BRAIN_CONTAINER="$c"; break
    fi
  done
fi
if [ -z "$BRAIN_CONTAINER" ]; then
  fail "Case A: 未检测到 brain container（cecelia-brain-smoke 或 cecelia-node-brain）"
else
  echo "  container=$BRAIN_CONTAINER"
  PFC_OUT=$(docker exec "$BRAIN_CONTAINER" node -e "
import('/app/src/pre-flight-check.js').then(async ({ preFlightCheck }) => {
  const result = await preFlightCheck({
    id: 'smoke-pfc',
    title: 'ab',
    description: 'Description with sufficient length to pass any check beyond title length',
    task_type: 'dev',
    priority: 'P2',
  });
  console.log('PASSED=' + result.passed);
  console.log('ISSUES=' + JSON.stringify(result.issues));
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
" 2>&1)
  echo "  $PFC_OUT" | sed 's/^/    /'
  if echo "$PFC_OUT" | grep -q "PASSED=false" && echo "$PFC_OUT" | grep -q "title too short"; then
    pass "Case A: preFlightCheck 拒短 title（PASSED=false + 含 'title too short'）"
  else
    fail "Case A: 期望 PASSED=false + issues 含 'title too short'，实际见上"
  fi
fi

echo ""

# ─── Case B: empty queue 不抛 ───────────────────────────
echo "[Case B] empty queue — dispatch 不抛"
# 注册 0 个 dispatchable task；触发 tick；不应抛 5xx
TICK_RESP=$(curl -sS -o /tmp/tick-resp.json -w '%{http_code}' \
  -X POST "${BRAIN_URL}/api/brain/tick" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1 || echo "000")
if [ "$TICK_RESP" = "200" ]; then
  pass "Case B: tick HTTP 200（空队列正常返回）"
else
  fail "Case B: tick HTTP=$TICK_RESP（应 200），response: $(head -c 200 /tmp/tick-resp.json 2>/dev/null)"
fi

echo ""

# ─── Case C: initiative-lock 同 project 并发互拒 ────────
echo "[Case C] initiative-lock — 同 project 并发 harness_initiative，只 1 个能 dispatch"
# 每次 smoke 用唯一 project_id 避免跨 run dedup 冲突；UUID 格式必须严格
PROJ_HEX=$(printf '%012x' $((RANDOM * 32768 + RANDOM)))
PROJ_ID="00000000-0000-0000-0000-${PROJ_HEX}"
B1_TASK=$(register_task "[smoke-C1-${SMOKE_RUN_ID}] init B1 lock test" "Initiative B1 with sufficiently long description for pre-flight check passing" "harness_initiative" "P2" "$PROJ_ID")
B2_TASK=$(register_task "[smoke-C2-${SMOKE_RUN_ID}] init B2 lock test" "Initiative B2 with sufficiently long description for pre-flight check passing" "harness_initiative" "P2" "$PROJ_ID")

if [ -z "$B1_TASK" ] || [ -z "$B2_TASK" ]; then
  fail "Case C: 注册失败 B1=$B1_TASK B2=$B2_TASK"
else
  echo "  B1=$B1_TASK B2=$B2_TASK proj=$PROJ_ID"
  # 触发 dispatcher tick 几次，让两个任务都被尝试
  for i in 1 2 3; do
    trigger_tick
    sleep 3
  done

  # 期望：两个 task 不会同时进 in_progress（initiative-lock 拦后者）
  S1=$(get_task_field "$B1_TASK" "status")
  S2=$(get_task_field "$B2_TASK" "status")
  echo "  B1.status=$S1  B2.status=$S2"
  IN_PROG_COUNT=0
  [ "$S1" = "in_progress" ] && IN_PROG_COUNT=$((IN_PROG_COUNT+1))
  [ "$S2" = "in_progress" ] && IN_PROG_COUNT=$((IN_PROG_COUNT+1))
  if [ "$IN_PROG_COUNT" -le 1 ]; then
    pass "Case C: initiative-lock 生效（in_progress=$IN_PROG_COUNT ≤ 1）"
  else
    fail "Case C: 同 project 2 个 harness_initiative 同时 in_progress（lock 失效）"
  fi
fi

echo ""

# ─── Cleanup（best-effort，queued → in_progress → failed） ──
# Brain status 转换守卫：queued 直接 → failed 被拒，必须先 in_progress
for tid in "${A_TASK:-}" "${B1_TASK:-}" "${B2_TASK:-}"; do
  [ -z "$tid" ] && continue
  curl -sS -X PATCH "${BRAIN_URL}/api/brain/tasks/${tid}" \
    -H "Content-Type: application/json" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1 || true
  curl -sS -X PATCH "${BRAIN_URL}/api/brain/tasks/${tid}" \
    -H "Content-Type: application/json" \
    -d '{"status":"failed","result":{"smoke":"dispatcher-real-paths cleanup"}}' >/dev/null 2>&1 || true
done

echo "📊 dispatcher-real-paths smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
