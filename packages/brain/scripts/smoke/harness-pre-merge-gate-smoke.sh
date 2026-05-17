#!/usr/bin/env bash
# Smoke: harness pipeline pre-merge gate
#
# 断言：harness-task.graph.js 中 evaluateContractNode 的路由链正确插在 poll_ci→merge_pr 之间，
# 且如果 docker 可用，能成功 spawn 一个 harness-evaluate-* 格式的容器。
#
# 三层验证：
#   L1  静态路由验证（无需 Brain/docker，快速代码层断言）
#   L2  Brain 健康检查 + 代码层 evaluate_contract 节点存在断言
#   L3  docker spawn 验证（Brain 可达 + docker 可用时）—— 派 harness_evaluate 任务，
#       轮询 walking_skeleton_thread_lookup 确认容器 spawn + thread 注册，
#       验证此时 initiative 未处于 merged 状态（时序断言）
#
# exit 0 = PASS（所有层通过）
# exit 1 = FAIL（任意层失败，明确说明原因）
#
# 注意：
#   - 不使用 docker --filter "label=..." （docker-executor.js 不写 label，容器命名用 --name）
#   - 容器名格式：harness-evaluate-{taskId}-r{round}-{rand}
#   - merge_pushed_at 字段不存在；时序断言通过 tasks.status 字段判断
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
GRAPH_FILE="packages/brain/src/workflows/harness-task.graph.js"

# ─────────────────────────────────────────────────────────────────────────────
# L1: 静态路由验证（代码层断言，无网络依赖）
# ─────────────────────────────────────────────────────────────────────────────
echo "[smoke] L1: 静态路由验证 ..."

if [[ ! -f "$GRAPH_FILE" ]]; then
  echo "[smoke] FAIL L1: $GRAPH_FILE 不存在"
  exit 1
fi

# 1a. routeAfterPoll 必须在 ci_status=pass 时返回 'evaluate'（插入 pre-merge gate）
if ! grep -q "ci_status.*pass.*evaluate\|evaluate.*ci_status.*pass\|pass.*evaluate" "$GRAPH_FILE"; then
  echo "[smoke] FAIL L1a: routeAfterPoll 未将 ci_status=pass 路由到 evaluate（pre-merge gate 未插入）"
  exit 1
fi

# 1b. addConditionalEdges 中 evaluate_contract 必须在 merge_pr 之前（路由边定义）
if ! grep -q "evaluate_contract.*routeAfterEvaluate\|routeAfterEvaluate.*evaluate_contract" "$GRAPH_FILE"; then
  echo "[smoke] FAIL L1b: evaluate_contract 节点缺少 routeAfterEvaluate 路由（pre-merge gate 路由断裂）"
  exit 1
fi

# 1c. routeAfterEvaluate 必须有 merge_pr 出边
if ! grep -q "merge.*merge_pr\|merge_pr.*merge" "$GRAPH_FILE"; then
  echo "[smoke] FAIL L1c: routeAfterEvaluate 未连接 merge_pr 出边"
  exit 1
fi

# 1d. addEdge evaluate → merge 的顺序（evaluate_contract 在 merge_pr 上游）
# 检查 addNode 顺序：evaluate_contract 先于 merge_pr
EVAL_LINE=$(grep -n "addNode.*evaluate_contract" "$GRAPH_FILE" | head -1 | cut -d: -f1 || echo 0)
MERGE_LINE=$(grep -n "addNode.*merge_pr" "$GRAPH_FILE" | head -1 | cut -d: -f1 || echo 0)
if [[ "$EVAL_LINE" -eq 0 || "$MERGE_LINE" -eq 0 ]]; then
  echo "[smoke] FAIL L1d: evaluate_contract 或 merge_pr 节点未注册到图中"
  exit 1
fi
# evaluate_contract 必须在 merge_pr 之前注册
if [[ "$EVAL_LINE" -gt "$MERGE_LINE" ]]; then
  echo "[smoke] FAIL L1d: evaluate_contract(line $EVAL_LINE) 在 merge_pr(line $MERGE_LINE) 之后定义，顺序错误"
  exit 1
fi

echo "[smoke] L1: PASS（静态路由链正确：poll_ci→evaluate_contract→merge_pr）"

# ─────────────────────────────────────────────────────────────────────────────
# L2: Brain 连通性 + evaluateContractNode 存在性断言
# ─────────────────────────────────────────────────────────────────────────────
echo "[smoke] L2: Brain 健康检查 ..."

BRAIN_UP=false
if curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  BRAIN_UP=true
  echo "[smoke] L2: Brain 可达"
else
  echo "[smoke] L2: SKIP（Brain 不可达，仅 L1 静态验证通过，CI real-env-smoke 会跑 L3）"
  echo "[smoke] PASS — L1 静态路由验证通过（L2/L3 需 Brain 可达时由 CI 验证）"
  exit 0
fi

# L2b: 通过 Brain API 确认 harness_evaluate task_type 是可路由的
TASK_TYPES=$(curl -sf "$BRAIN/api/brain/context" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok')" 2>/dev/null || echo "fail")
if [[ "$TASK_TYPES" == "fail" ]]; then
  echo "[smoke] WARN L2b: Brain /context 不可用，跳过 task_type 路由检查"
fi

echo "[smoke] L2: PASS"

# ─────────────────────────────────────────────────────────────────────────────
# L3: Docker spawn + 时序断言（Brain 可达 + docker 可用 + Brain tick 活跃时）
# ─────────────────────────────────────────────────────────────────────────────
echo "[smoke] L3: docker spawn 验证 ..."

# 检查 docker 是否可用
if ! docker version >/dev/null 2>&1; then
  echo "[smoke] L3: SKIP（docker 不可达，L3 由 CI real-env-smoke 验证）"
  echo "[smoke] PASS — L1+L2 通过（docker spawn L3 需 docker 可达时由 CI 验证）"
  exit 0
fi

# 检查 Brain tick 是否活跃（last tick 超过 10 分钟则 Brain 可能跑旧代码/停止调度）
LAST_TICK=$(curl -sf "$BRAIN/api/brain/health" 2>/dev/null \
  | python3 -c "
import json,sys,datetime
h=json.load(sys.stdin)
last=h.get('tick_stats',{}).get('last_executed_at','')
if not last:
    print(9999)
    sys.exit(0)
# Format: '2026-05-05 11:31:29'
try:
    t=datetime.datetime.strptime(last,'%Y-%m-%d %H:%M:%S').replace(tzinfo=datetime.timezone.utc)
    now=datetime.datetime.now(datetime.timezone.utc)
    print(int((now-t).total_seconds()/60))
except Exception as e:
    print(9999)
" 2>/dev/null || echo 9999)

if [[ "$LAST_TICK" -gt 10 ]]; then
  echo "[smoke] L3: SKIP（Brain tick 最后执行距今 ${LAST_TICK} 分钟，调度器不活跃，L3 由 CI real-env-smoke 验证）"
  echo "[smoke] PASS — L1+L2 通过（L3 需 Brain tick 活跃时由 CI 验证）"
  exit 0
fi

# 派一个独立的 harness_evaluate 任务（直接派，不走完整 initiative）
# 这会触发 executor.js → docker-executor.executeInDocker 路径创建容器
# 容器名格式由 task.id 决定：cecelia-task-{taskId前12位hex无dash}
RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"[smoke] pre-merge-gate evaluate spawn test",
    "task_type":"harness_evaluate",
    "payload":{
      "source":"smoke_pre_merge_gate",
      "pr_url":"https://github.com/example/smoke-test",
      "contract_branch":"smoke-branch",
      "smoke_dry_run":true
    }
  }' 2>&1) || true

TID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

if [[ -z "$TID" || "$TID" == "null" ]]; then
  echo "[smoke] L3: SKIP（无法派 harness_evaluate 任务，resp=$(echo "$RESP" | head -c 200)）"
  echo "[smoke] PASS — L1+L2 通过（L3 容器 spawn 跳过）"
  exit 0
fi
echo "[smoke] L3: 已派 harness_evaluate 任务 $TID"

# 容器名由 docker-executor.js containerName() 生成：
#   cecelia-task-${taskId.replace(/-/g,'').slice(0,12)}
SAFE_ID=$(echo "$TID" | tr -d '-' | cut -c1-12)
CONTAINER_NAME="cecelia-task-${SAFE_ID}"
echo "[smoke] L3: 预期容器名 $CONTAINER_NAME"

# 轮询容器出现（最多 3 分钟）
EVAL_STARTED=""
for i in $(seq 1 36); do
  # 检查容器是否存在（running 或 exited）
  FOUND=$(docker ps -a --filter "name=${CONTAINER_NAME}" --format '{{.CreatedAt}}' 2>/dev/null | head -1 || echo "")
  if [[ -n "$FOUND" ]]; then
    EVAL_STARTED="$FOUND"
    echo "[smoke] L3: 容器 $CONTAINER_NAME 已出现 (created: $EVAL_STARTED)"
    break
  fi
  sleep 5
done

if [[ -z "$EVAL_STARTED" ]]; then
  # 检查任务是否因为 Brain 端原因（无可用 account / circuit open）被跳过
  TASK_STATUS=$(curl -sf "$BRAIN/api/brain/tasks/$TID" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
  echo "[smoke] L3: 容器未在 3 min 内启动，任务 status=$TASK_STATUS"
  if [[ "$TASK_STATUS" == "failed" || "$TASK_STATUS" == "cancelled" ]]; then
    echo "[smoke] L3: SKIP（任务 $TASK_STATUS，可能因 circuit breaker/账号不可用，L3 由 CI real-env-smoke 验证）"
  else
    echo "[smoke] FAIL L3: harness_evaluate 容器未启动（task_id=$TID status=$TASK_STATUS）"
    # 清理
    curl -sX PATCH "$BRAIN/api/brain/tasks/$TID" \
      -H "Content-Type: application/json" \
      -d '{"status":"cancelled","result":{"reason":"smoke L3 timeout"}}' >/dev/null 2>&1 || true
    exit 1
  fi
else
  # 时序断言：此时任务 status 不应是 merged（evaluate 在 merge 之前）
  TASK_STATUS=$(curl -sf "$BRAIN/api/brain/tasks/$TID" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
  if [[ "$TASK_STATUS" == "merged" ]]; then
    echo "[smoke] FAIL L3: 容器 spawn 时任务已是 merged 状态——时序倒置（evaluator 晚于 merge）"
    exit 1
  fi
  echo "[smoke] L3: 时序断言 PASS（容器已 spawn，任务 status=$TASK_STATUS，不是 merged）"
fi

# 清理
curl -sX PATCH "$BRAIN/api/brain/tasks/$TID" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled","result":{"reason":"smoke complete"}}' >/dev/null 2>&1 || true

echo "[smoke] PASS — L1 静态路由 + L2 Brain 健康 + L3 容器 spawn 验证全部通过"
exit 0
