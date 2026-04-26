#!/usr/bin/env bash
# C8b Content Pipeline Idempotent — real-env smoke
#
# 目标：验证 content-pipeline LangGraph workflow 在 Brain 重启后能从 PG checkpoint
#      续跑（resume），已完成节点不重 spawn docker（幂等门生效）。
#
# 验证点：
#   1. POST /api/brain/content-pipeline/<id>/run-langgraph 起一条 stub pipeline
#   2. 等 30s 让 pipeline 走完至少 1 个节点（state.research/copywriting/... 写到 PG checkpoint）
#   3. docker kill cecelia-node-brain → restart（强模拟崩溃恢复）
#   4. 等 brain 健康
#   5. 重新 POST run-langgraph 同一 id → docker logs 必须出现 "resume skip" 行
#      （signature: [content-pipeline-graph] node=<X> task=<id> resume skip (state.<field> exists)）
#   6. cleanup：把 stub pipeline task 删除（或标 cancelled）
#
# 警告：本 smoke 会重启 BRAIN_CONTAINER，影响所有正在 dispatch 的任务。
# 默认需显式 SMOKE_DESTRUCTIVE=1 才执行 docker kill（CI/local 都需要主动开）。
#
# 依赖：cecelia-node-brain + PG (cecelia-postgres) 都跑着，CONTENT_PIPELINE_LANGGRAPH_ENABLED=true
# 失败：exit 1
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-node-brain}"
PG_CONTAINER="${PG_CONTAINER:-cecelia-postgres}"
PG_USER="${PG_USER:-cecelia}"
PG_DB="${PG_DB:-cecelia}"
WAIT_BEFORE_KILL_S="${SMOKE_WAIT_S:-30}"
SMOKE_DESTRUCTIVE="${SMOKE_DESTRUCTIVE:-0}"

echo "=== C8b Content Pipeline Idempotent Smoke ==="
echo "  BRAIN_URL=$BRAIN_URL"
echo "  BRAIN_CONTAINER=$BRAIN_CONTAINER"
echo "  PG_CONTAINER=$PG_CONTAINER"
echo "  WAIT_BEFORE_KILL_S=$WAIT_BEFORE_KILL_S"
echo "  SMOKE_DESTRUCTIVE=$SMOKE_DESTRUCTIVE"
echo ""

if [ "$SMOKE_DESTRUCTIVE" != "1" ]; then
  echo "⚠️  SMOKE_DESTRUCTIVE!=1 — 跳过 docker kill 部分（仅做 happy-path 验证）"
  echo "    要做完整破坏式测试请设 SMOKE_DESTRUCTIVE=1"
fi

FAILED=0
STUB_TASK_ID=""
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

cleanup() {
  if [ -n "$STUB_TASK_ID" ]; then
    echo ""
    echo "[cleanup] 删 stub task $STUB_TASK_ID"
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
      "DELETE FROM tasks WHERE id = '$STUB_TASK_ID';" >/dev/null 2>&1 || \
      echo "  cleanup 失败（容忍）— 残留 task: $STUB_TASK_ID"
  fi
}
trap cleanup EXIT

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq 未安装"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "FATAL: docker 未安装"; exit 1; }

# 容器健康
docker ps --format '{{.Names}}' | grep -qx "$BRAIN_CONTAINER" || { echo "FATAL: $BRAIN_CONTAINER 未跑"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" || { echo "FATAL: $PG_CONTAINER 未跑"; exit 1; }

# 1) 创 stub content-pipeline task（直插 PG，避开 dashboard / dispatcher 干扰）
echo "[1/6] 创建 stub content-pipeline task"
STUB_KEYWORD="smoke-c8b-$(date +%s)"
STUB_TASK_ID="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
  "INSERT INTO tasks (task_type, title, status, priority, payload, created_at)
   VALUES ('content-pipeline', '[smoke] $STUB_KEYWORD', 'queued', 'P3',
           jsonb_build_object('keyword', '$STUB_KEYWORD', 'output_dir', '/tmp/smoke-$STUB_KEYWORD', 'smoke_test', true),
           NOW())
   RETURNING id;")"
STUB_TASK_ID="$(echo "$STUB_TASK_ID" | tr -d '[:space:]')"
if [ -z "$STUB_TASK_ID" ]; then
  fail "创建 stub task 失败"
  exit 1
fi
pass "stub task 创建: $STUB_TASK_ID (keyword=$STUB_KEYWORD)"

# 2) 起第一次 langgraph
echo ""
echo "[2/6] POST /api/brain/content-pipeline/$STUB_TASK_ID/run-langgraph 第一次"
RUN1_BODY="$(curl -sS -o /tmp/smoke-c8b-run1.json -w '%{http_code}' \
  -X POST "$BRAIN_URL/api/brain/content-pipeline/$STUB_TASK_ID/run-langgraph" \
  -H 'Content-Type: application/json' -d '{}')" || true
if [ "$RUN1_BODY" = "202" ] || [ "$RUN1_BODY" = "200" ]; then
  pass "第一次 run-langgraph 返回 $RUN1_BODY"
elif [ "$RUN1_BODY" = "503" ] && grep -q "LANGGRAPH_DISABLED" /tmp/smoke-c8b-run1.json 2>/dev/null; then
  fail "CONTENT_PIPELINE_LANGGRAPH_ENABLED 未开 — 此 smoke 不适用，跳过"
  cat /tmp/smoke-c8b-run1.json
  exit 1
else
  fail "第一次 run-langgraph HTTP=$RUN1_BODY"
  cat /tmp/smoke-c8b-run1.json 2>/dev/null || true
  exit 1
fi

# 3) 等 pipeline 跑到中间
echo ""
echo "[3/6] 等 ${WAIT_BEFORE_KILL_S}s 让 pipeline 至少跑 1 个节点（写 PG checkpoint）"
sleep "$WAIT_BEFORE_KILL_S"

# 验 PG 已有 checkpoint（migration 244 表 — checkpoint thread_id 含 pipeline_id）
CP_ROWS="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
  "SELECT COUNT(*) FROM checkpoints WHERE thread_id LIKE '%$STUB_TASK_ID%';" 2>/dev/null || echo 0)"
CP_ROWS="$(echo "$CP_ROWS" | tr -d '[:space:]')"
if [ "$CP_ROWS" -gt 0 ] 2>/dev/null; then
  pass "PG checkpoints 已写入 ($CP_ROWS rows for thread $STUB_TASK_ID)"
else
  fail "PG checkpoints 无记录 — pipeline 可能没启动 or workflow 未到 checkpoint 节点"
fi

# 4) 破坏式：docker kill + restart
if [ "$SMOKE_DESTRUCTIVE" = "1" ]; then
  echo ""
  echo "[4/6] docker kill $BRAIN_CONTAINER + restart（模拟崩溃）"
  docker kill "$BRAIN_CONTAINER" >/dev/null
  pass "kill 完成"
  docker start "$BRAIN_CONTAINER" >/dev/null
  pass "start 完成，等 health"

  # 等 brain 起来
  HEALTHY=0
  for i in $(seq 1 60); do
    if curl -sf "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
      pass "brain healthy (${i}s)"
      HEALTHY=1
      break
    fi
    sleep 1
  done
  [ "$HEALTHY" -eq 1 ] || { fail "brain 60s 未起"; exit 1; }
else
  echo ""
  echo "[4/6] 跳过 kill（SMOKE_DESTRUCTIVE!=1）— 只验非破坏路径的幂等门"
fi

# 5) 第二次 run-langgraph 同 id → 期望 docker logs 出现 "resume skip"
echo ""
echo "[5/6] 第二次 run-langgraph + 验 docker logs 出现 resume skip"
LOG_MARK_TIME="$(date -u +%s)"
sleep 1
RUN2_CODE="$(curl -sS -o /tmp/smoke-c8b-run2.json -w '%{http_code}' \
  -X POST "$BRAIN_URL/api/brain/content-pipeline/$STUB_TASK_ID/run-langgraph" \
  -H 'Content-Type: application/json' -d '{}')" || true
if [ "$RUN2_CODE" = "202" ] || [ "$RUN2_CODE" = "200" ]; then
  pass "第二次 run-langgraph 返回 $RUN2_CODE"
else
  fail "第二次 run-langgraph HTTP=$RUN2_CODE"
  cat /tmp/smoke-c8b-run2.json 2>/dev/null || true
fi

# 等 pipeline 第二次跑过中间（resume skip 日志会立即出）
sleep 30

# 在 brain logs 找 "resume skip" 含 task=$STUB_TASK_ID
LOGS_SINCE="$((($(date -u +%s) - LOG_MARK_TIME) + 60))s"
RESUME_LINES="$(docker logs --since "$LOGS_SINCE" "$BRAIN_CONTAINER" 2>&1 | grep -F 'resume skip' | grep -F "task=$STUB_TASK_ID" || true)"

if [ -n "$RESUME_LINES" ]; then
  pass "resume skip 日志命中 ($(echo "$RESUME_LINES" | wc -l | tr -d ' ') 行)"
  echo "$RESUME_LINES" | head -3 | sed 's/^/    /'
else
  fail "未找到 resume skip 日志（task=$STUB_TASK_ID）"
  echo "  近期 content-pipeline-graph 日志（参考）："
  docker logs --since "$LOGS_SINCE" "$BRAIN_CONTAINER" 2>&1 | grep -F 'content-pipeline-graph' | tail -10 | sed 's/^/    /' || true
fi

# 6) cleanup 由 trap 自动做
echo ""
echo "[6/6] cleanup 将由 trap 处理"

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ C8b Content Pipeline Idempotent smoke PASSED"
  exit 0
else
  echo "❌ C8b Content Pipeline Idempotent smoke FAILED"
  exit 1
fi
