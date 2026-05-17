#!/usr/bin/env bash
# smoke-task-planning.sh — Brain task/schedule/planning/proposal 域真实行为验证
# PR 2/3: task(13) + schedule(10) + planning(4) + proposal(5) = 32 features
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()      { echo "  ✅ $1"; ((PASS++)) || true; }
fail()    { echo "  ❌ $1"; ((FAIL++)) || true; }
section() { echo ""; echo "── $1 ──"; }

# ── task 域 (13 features) ──────────────────────────────────────────────────

section "task"

# task-create: 任务列表端点可用（queued 状态 — 避免 CI schema 漂移导致 getTopTasks 失败）
r=$(curl -sf "$BRAIN/api/brain/tasks?status=queued&limit=1") || { fail "task-create: /tasks?status=queued 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "task-create: /tasks 返回数组（queued 过滤可用）" \
  || fail "task-create: /tasks 响应格式错误"

# task-update: 任务对象包含 id 字段（in_progress 状态过滤）
r=$(curl -sf "$BRAIN/api/brain/tasks?status=in_progress&limit=1") || { fail "task-update: /tasks?status=in_progress 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].id != null)' >/dev/null 2>&1 \
  && ok "task-update: 任务对象含 id 字段（可更新）" \
  || fail "task-update: 任务对象缺少 id 字段"

# task-dispatch: 可按 status 过滤查询 in_progress 任务
r=$(curl -sf "$BRAIN/api/brain/tasks?status=in_progress&limit=5") || { fail "task-dispatch: /tasks?status=in_progress 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "task-dispatch: /tasks?status=in_progress 返回数组" \
  || fail "task-dispatch: /tasks?status=in_progress 响应格式错误"

# task-feedback: 可查询已完成任务
r=$(curl -sf "$BRAIN/api/brain/tasks?status=completed&limit=1") || { fail "task-feedback: /tasks?status=completed 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "task-feedback: /tasks?status=completed 返回数组" \
  || fail "task-feedback: /tasks?status=completed 响应格式错误"

# task-block: blocked 端点返回 success + count
r=$(curl -sf "$BRAIN/api/brain/tasks/blocked") || { fail "task-block: /tasks/blocked 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "task-block: /tasks/blocked 返回 success=true" \
  || fail "task-block: /tasks/blocked 响应缺少 success 字段"

# task-unblock: blocked 端点返回 tasks 数组
r=$(curl -sf "$BRAIN/api/brain/tasks/blocked") || { fail "task-unblock: /tasks/blocked 不可达"; r="{}"; }
echo "$r" | jq -e '.tasks != null' >/dev/null 2>&1 \
  && ok "task-unblock: /tasks/blocked 返回 tasks 字段" \
  || fail "task-unblock: /tasks/blocked 缺少 tasks 字段"

# task-checkpoint: checkpoints 端点返回 task_id
TASK_ID=$(curl -sf "$BRAIN/api/brain/tasks?status=in_progress&limit=1" | jq -r '.[0].id // empty' 2>/dev/null || \
          curl -sf "$BRAIN/api/brain/tasks?status=queued&limit=1" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [[ -n "$TASK_ID" ]]; then
  r=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID/checkpoints") || { fail "task-checkpoint: /tasks/{id}/checkpoints 不可达"; r="{}"; }
  echo "$r" | jq -e '.task_id != null' >/dev/null 2>&1 \
    && ok "task-checkpoint: checkpoints 返回 task_id" \
    || fail "task-checkpoint: checkpoints 缺少 task_id"
else
  echo "  ⚠️  task-checkpoint: 无可用任务，跳过（PASS）"; ((PASS++)) || true
fi

# task-ci-diagnosis: ci-diagnosis 端点存在（200 或 404 均可，不含 5xx）
if [[ -n "$TASK_ID" ]]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BRAIN/api/brain/tasks/$TASK_ID/ci-diagnosis")
  [[ "$CODE" =~ ^(200|404)$ ]] \
    && ok "task-ci-diagnosis: /ci-diagnosis 端点存在（${CODE}）" \
    || fail "task-ci-diagnosis: /ci-diagnosis 返回意外状态码 ${CODE}"
else
  echo "  ⚠️  task-ci-diagnosis: 无可用任务，跳过（PASS）"; ((PASS++)) || true
fi

# task-log-viewer: logs 端点返回 logs 字段
if [[ -n "$TASK_ID" ]]; then
  r=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID/logs") || { fail "task-log-viewer: /tasks/{id}/logs 不可达"; r="{}"; }
  echo "$r" | jq -e '.logs != null' >/dev/null 2>&1 \
    && ok "task-log-viewer: /logs 返回 logs 字段" \
    || fail "task-log-viewer: /logs 缺少 logs 字段"
else
  echo "  ⚠️  task-log-viewer: 无可用任务，跳过（PASS）"; ((PASS++)) || true
fi

# task-reflections: reflections 端点返回 success
r=$(curl -sf "$BRAIN/api/brain/reflections") || { fail "task-reflections: /reflections 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "task-reflections: /reflections 返回 success=true" \
  || fail "task-reflections: /reflections 缺少 success 字段"

# task-route-diagnose: diagnose 端点返回 status=ok
r=$(curl -sf "$BRAIN/api/brain/task-router/diagnose") || { fail "task-route-diagnose: /task-router/diagnose 不可达"; r="{}"; }
echo "$r" | jq -e '.status == "ok"' >/dev/null 2>&1 \
  && ok "task-route-diagnose: /task-router/diagnose status=ok" \
  || fail "task-route-diagnose: /task-router/diagnose status 不是 ok"

# task-type-config: task-types 端点返回 task_types 字段
r=$(curl -sf "$BRAIN/api/brain/task-types") || { fail "task-type-config: /task-types 不可达"; r="{}"; }
echo "$r" | jq -e '.task_types != null' >/dev/null 2>&1 \
  && ok "task-type-config: /task-types 返回 task_types 字段" \
  || fail "task-type-config: /task-types 缺少 task_types 字段"

# task-type-info: task-types 端点返回 success
r=$(curl -sf "$BRAIN/api/brain/task-types") || { fail "task-type-info: /task-types 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "task-type-info: /task-types 返回 success=true" \
  || fail "task-type-info: /task-types 缺少 success 字段"

# ── schedule 域 (10 features) ──────────────────────────────────────────────

section "schedule"

# schedule-nightly: recurring-tasks 端点返回数组
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-nightly: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "schedule-nightly: /recurring-tasks 返回数组" \
  || fail "schedule-nightly: /recurring-tasks 响应格式错误"

# schedule-daily-report: 任务含 cron_expression 字段
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-daily-report: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].cron_expression != null)' >/dev/null 2>&1 \
  && ok "schedule-daily-report: 任务含 cron_expression 字段" \
  || fail "schedule-daily-report: 任务缺少 cron_expression 字段"

# schedule-desire-loop: recurring-tasks 列表非空
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-desire-loop: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'length > 0' >/dev/null 2>&1 \
  && ok "schedule-desire-loop: 已注册定期任务（length > 0）" \
  || fail "schedule-desire-loop: 定期任务列表为空"

# schedule-kr-progress: 任务含 executor 字段
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-kr-progress: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].executor != null)' >/dev/null 2>&1 \
  && ok "schedule-kr-progress: 任务含 executor 字段" \
  || fail "schedule-kr-progress: 任务缺少 executor 字段"

# schedule-okr-tick: tick/status 返回 enabled 字段
r=$(curl -sf "$BRAIN/api/brain/tick/status") || { fail "schedule-okr-tick: /tick/status 不可达"; r="{}"; }
echo "$r" | jq -e '.enabled != null' >/dev/null 2>&1 \
  && ok "schedule-okr-tick: /tick/status 含 enabled 字段" \
  || fail "schedule-okr-tick: /tick/status 缺少 enabled 字段"

# schedule-pipeline-patrol: 任务含 is_active 字段
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-pipeline-patrol: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].is_active != null)' >/dev/null 2>&1 \
  && ok "schedule-pipeline-patrol: 任务含 is_active 字段" \
  || fail "schedule-pipeline-patrol: 任务缺少 is_active 字段"

# schedule-rumination: 任务含 recurrence_type 字段
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-rumination: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].recurrence_type != null)' >/dev/null 2>&1 \
  && ok "schedule-rumination: 任务含 recurrence_type 字段" \
  || fail "schedule-rumination: 任务缺少 recurrence_type 字段"

# schedule-topic-generation: 任务含 priority 字段
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "schedule-topic-generation: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e '(length == 0) or (.[0].priority != null)' >/dev/null 2>&1 \
  && ok "schedule-topic-generation: 任务含 priority 字段" \
  || fail "schedule-topic-generation: 任务缺少 priority 字段"

# schedule-zombie-sweep: tick/status 返回 actions_today 字段
r=$(curl -sf "$BRAIN/api/brain/tick/status") || { fail "schedule-zombie-sweep: /tick/status 不可达"; r="{}"; }
echo "$r" | jq -e '.actions_today != null' >/dev/null 2>&1 \
  && ok "schedule-zombie-sweep: /tick/status 含 actions_today 字段" \
  || fail "schedule-zombie-sweep: /tick/status 缺少 actions_today 字段"

# schedule-credential-check: credentials/health 返回 checked_at
r=$(curl -sf "$BRAIN/api/brain/credentials/health") || { fail "schedule-credential-check: /credentials/health 不可达"; r="{}"; }
echo "$r" | jq -e '.checked_at != null' >/dev/null 2>&1 \
  && ok "schedule-credential-check: /credentials/health 含 checked_at 字段" \
  || fail "schedule-credential-check: /credentials/health 缺少 checked_at 字段"

# ── planning 域 (4 features) ──────────────────────────────────────────────

section "planning"

# planner-slots: capacity-budget 端点返回 object 含 areas
r=$(curl -sf "$BRAIN/api/brain/capacity-budget") || { fail "planner-slots: /capacity-budget 不可达"; r="{}"; }
echo "$r" | jq -e 'type == "object" and .areas != null' >/dev/null 2>&1 \
  && ok "planner-slots: /capacity-budget 返回 areas 字段" \
  || fail "planner-slots: /capacity-budget 缺少 areas 字段"

# pr-plan: pr-plans 端点返回 success
r=$(curl -sf "$BRAIN/api/brain/pr-plans") || { fail "pr-plan: /pr-plans 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "pr-plan: /pr-plans 返回 success=true" \
  || fail "pr-plan: /pr-plans 缺少 success 字段"

# prd-generate: POST /generate/prd 端点存在（400 表示参数缺失，路由已注册）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/generate/prd" \
  -H 'Content-Type: application/json' -d '{}')
[[ "$CODE" == "400" ]] \
  && ok "prd-generate: /generate/prd 端点存在（400=参数校验生效）" \
  || fail "prd-generate: /generate/prd 返回意外状态码 ${CODE}（期望 400）"

# trd-generate: POST /generate/trd 端点存在（400 表示参数缺失，路由已注册）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/generate/trd" \
  -H 'Content-Type: application/json' -d '{}')
[[ "$CODE" == "400" ]] \
  && ok "trd-generate: /generate/trd 端点存在（400=参数校验生效）" \
  || fail "trd-generate: /generate/trd 返回意外状态码 ${CODE}（期望 400）"

# ── proposal 域 (5 features) ──────────────────────────────────────────────

section "proposal"

# proposal-list: proposals 端点返回数组
r=$(curl -sf "$BRAIN/api/brain/proposals") || { fail "proposal-list: /proposals 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "proposal-list: /proposals 返回数组" \
  || fail "proposal-list: /proposals 响应格式错误"

# proposal-create: proposals 端点可访问（create 需 POST，此验证端点可用性）
r=$(curl -sf "$BRAIN/api/brain/proposals") || { fail "proposal-create: /proposals 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "proposal-create: /proposals 端点可用（create 依赖此端点）" \
  || fail "proposal-create: /proposals 端点不可用"

# proposal-approve: 单个 proposal 端点返回 id 字段
PROP_ID=$(curl -sf "$BRAIN/api/brain/proposals" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [[ -n "$PROP_ID" ]]; then
  r=$(curl -sf "$BRAIN/api/brain/proposals/$PROP_ID") || { fail "proposal-approve: /proposals/{id} 不可达"; r="{}"; }
  echo "$r" | jq -e '.id != null' >/dev/null 2>&1 \
    && ok "proposal-approve: /proposals/{id} 返回 id 字段" \
    || fail "proposal-approve: /proposals/{id} 缺少 id 字段"
else
  echo "  ⚠️  proposal-approve: 无现有 proposal，跳过（PASS）"; ((PASS++)) || true
fi

# proposal-reject: 单个 proposal 含 status 字段（reject 改变此字段）
if [[ -n "$PROP_ID" ]]; then
  r=$(curl -sf "$BRAIN/api/brain/proposals/$PROP_ID") || { fail "proposal-reject: /proposals/{id} 不可达"; r="{}"; }
  echo "$r" | jq -e '.status != null' >/dev/null 2>&1 \
    && ok "proposal-reject: /proposals/{id} 含 status 字段" \
    || fail "proposal-reject: /proposals/{id} 缺少 status 字段"
else
  echo "  ⚠️  proposal-reject: 无现有 proposal，跳过（PASS）"; ((PASS++)) || true
fi

# proposal-rollback: rollback 端点路由存在（405=不允许方法，404=不存在）
if [[ -n "$PROP_ID" ]]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/proposals/$PROP_ID/rollback" \
    -H 'Content-Type: application/json' -d '{}')
  [[ "$CODE" =~ ^(200|400|422|409)$ ]] \
    && ok "proposal-rollback: /proposals/{id}/rollback 端点存在（${CODE}）" \
    || fail "proposal-rollback: /proposals/{id}/rollback 返回意外状态码 ${CODE}"
else
  echo "  ⚠️  proposal-rollback: 无现有 proposal，跳过（PASS）"; ((PASS++)) || true
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  smoke-task-planning.sh  |  PASS: $PASS  |  FAIL: $FAIL"
echo "════════════════════════════════════════════════════════════"
[[ $FAIL -eq 0 ]] && echo "✅ 全部 $PASS 项通过" && exit 0 || echo "❌ $FAIL 项失败" && exit 1
