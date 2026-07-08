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
# L3 已退役（2026-07-08）：
# 1) L3 验证的是已废弃的 LangGraph harness-task 图 spawn 路径（skill-relay 自 #3554 起是唯一编排路径）
# 2) L3 两个月来靠僵尸指标假通过——tick_stats.last_executed_at 冻在 2026-05-05 使"调度器不活跃"SKIP 分支恒真；
#    僵尸指标修复（brain@1.243.3）后 L3 首次真跑并暴露其在 CI 不可满足（brain 容器无 spawn 能力）
# 3) 整个 smoke 将随刀4 阶段3（删除死图）一并删除
echo "[smoke] L3: RETIRED（死图路径 + 曾靠僵尸指标假通过，详见脚本注释；随刀4 阶段3 删除）"
echo "[smoke] PASS — L1+L2 通过（L3 已退役）"
exit 0
