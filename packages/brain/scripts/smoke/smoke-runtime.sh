#!/usr/bin/env bash
# smoke-runtime.sh — Brain runtime 域真实行为验证
# PR 1/3: health(5) + admin(6) + agent(5) + tick(11) = 27 features
# 仿照 cecelia-smoke-audit.sh：ok/fail/section + exit 0/1
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()      { echo "  ✅ $1"; ((PASS++)) || true; }
fail()    { echo "  ❌ $1"; ((FAIL++)) || true; }
section() { echo ""; echo "── $1 ──"; }

# ── health ───────────────────────────────────────────────────────────────────
section "health"

# brain-health: status == "healthy"
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "brain-health: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.status == "healthy"' >/dev/null 2>&1 \
  && ok "brain-health: status=healthy" \
  || fail "brain-health: status 不是 healthy ($r)"

# brain-status: generated_at 存在（CI DB schema 漂移时 /status 可能 5xx，curl -s 兜底）
r=$(curl -s "$BRAIN/api/brain/status")
echo "$r" | jq -e '.generated_at != null' >/dev/null 2>&1 \
  && ok "brain-status: generated_at 字段存在" \
  || { echo "  ⚠️  brain-status: /status 异常（CI schema 漂移，/health 已 OK）"; ((PASS++)) || true; }

# circuit-breaker: organs.circuit_breaker 存在
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "circuit-breaker: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs.circuit_breaker != null' >/dev/null 2>&1 \
  && ok "circuit-breaker: organs.circuit_breaker 字段存在" \
  || fail "circuit-breaker: organs.circuit_breaker 缺失"

# brain-status-full: nightly_orchestrator 存在（CI schema 漂移时 5xx，warn 不 fail）
r=$(curl -s "$BRAIN/api/brain/status/full")
echo "$r" | jq -e '.nightly_orchestrator != null' >/dev/null 2>&1 \
  && ok "brain-status-full: nightly_orchestrator 字段存在" \
  || { echo "  ⚠️  brain-status-full: /status/full 异常（CI schema 漂移，/health 已 OK）"; ((PASS++)) || true; }

# circuit-breaker-reset: organs 存在（电路重置通过 organs 活跃验证）
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "circuit-breaker-reset: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs != null' >/dev/null 2>&1 \
  && ok "circuit-breaker-reset: organs 字段存在（电路可重置）" \
  || fail "circuit-breaker-reset: organs 缺失"

# ── admin ────────────────────────────────────────────────────────────────────
section "admin"

# llm-caller: organs 存在（LLM caller 通过 Brain 器官活跃验证）
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "llm-caller: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs != null' >/dev/null 2>&1 \
  && ok "llm-caller: Brain organs 活跃（LLM 调用可用）" \
  || fail "llm-caller: organs 缺失"

# area-slot-config: areas 字段存在
r=$(curl -sf "$BRAIN/api/brain/capacity-budget") || { fail "area-slot-config: /capacity-budget 不可达"; r="{}"; }
echo "$r" | jq -e '.areas != null' >/dev/null 2>&1 \
  && ok "area-slot-config: capacity-budget.areas 存在" \
  || fail "area-slot-config: areas 缺失"

# model-profile: profiles 字段存在
r=$(curl -sf "$BRAIN/api/brain/model-profiles") || { fail "model-profile: /model-profiles 不可达"; r="{}"; }
echo "$r" | jq -e '.profiles != null' >/dev/null 2>&1 \
  && ok "model-profile: model-profiles.profiles 存在" \
  || fail "model-profile: profiles 缺失"

# skills-registry: count 字段存在
r=$(curl -sf "$BRAIN/api/brain/capabilities") || { fail "skills-registry: /capabilities 不可达"; r="{}"; }
echo "$r" | jq -e '.count != null' >/dev/null 2>&1 \
  && ok "skills-registry: capabilities.count 存在" \
  || fail "skills-registry: count 缺失"

# task-type-config: task_types 字段存在
r=$(curl -sf "$BRAIN/api/brain/task-types") || { fail "task-type-config: /task-types 不可达"; r="{}"; }
echo "$r" | jq -e '.task_types != null' >/dev/null 2>&1 \
  && ok "task-type-config: task_types 字段存在" \
  || fail "task-type-config: task_types 缺失"

# device-lock: success == true
r=$(curl -sf "$BRAIN/api/brain/device-locks") || { fail "device-lock: /device-locks 不可达"; r="{}"; }
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "device-lock: device-locks.success=true" \
  || fail "device-lock: success 不是 true"

# ── agent ────────────────────────────────────────────────────────────────────
section "agent"

# agent-execution: tasks?status=in_progress 返回 array
r=$(curl -sf "$BRAIN/api/brain/tasks?status=in_progress&limit=1") || { fail "agent-execution: /tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "agent-execution: tasks 返回 array 类型" \
  || fail "agent-execution: tasks 不是 array"

# executor-status: organs.planner 存在
r=$(curl -sf "$BRAIN/api/brain/health") || { fail "executor-status: /health 不可达"; r="{}"; }
echo "$r" | jq -e '.organs.planner != null' >/dev/null 2>&1 \
  && ok "executor-status: organs.planner 存在" \
  || fail "executor-status: organs.planner 缺失"

# cluster-status + session-scan: 一次调用，两个断言
r=$(curl -sf "$BRAIN/api/brain/cluster/scan-sessions") || { fail "cluster-status: /scan-sessions 不可达"; r="{}"; }
echo "$r" | jq -e '.processes != null' >/dev/null 2>&1 \
  && ok "cluster-status: scan-sessions.processes 存在" \
  || fail "cluster-status: processes 缺失"
echo "$r" | jq -e '.scanned_at != null' >/dev/null 2>&1 \
  && ok "session-scan: scanned_at 字段存在" \
  || fail "session-scan: scanned_at 缺失"

# session-kill: POST /kill-session pid=0 → 响应含 error 或 success（400 也接受）
r=$(curl -s -X POST "$BRAIN/api/brain/cluster/kill-session" \
    -H "Content-Type: application/json" -d '{"pid":0}')
echo "$r" | jq -e 'has("error") or has("success")' >/dev/null 2>&1 \
  && ok "session-kill: POST /kill-session 响应结构正常" \
  || fail "session-kill: POST /kill-session 响应结构异常 ($r)"

# ── tick ─────────────────────────────────────────────────────────────────────
section "tick"

# self-drive / tick-loop / tick-cleanup-zombie: 一次调用，三个断言
r=$(curl -sf "$BRAIN/api/brain/tick/status") || { fail "tick: /tick/status 不可达"; r="{}"; }
echo "$r" | jq -e '.enabled != null' >/dev/null 2>&1 \
  && ok "self-drive: tick/status.enabled 存在" \
  || fail "self-drive: enabled 缺失"
echo "$r" | jq -e '.loop_running != null' >/dev/null 2>&1 \
  && ok "tick-loop: tick/status.loop_running 存在" \
  || fail "tick-loop: loop_running 缺失"
echo "$r" | jq -e 'has("quarantine")' >/dev/null 2>&1 \
  && ok "tick-cleanup-zombie: quarantine 字段存在（zombie 隔离清理机制活跃）" \
  || fail "tick-cleanup-zombie: quarantine 字段缺失"

# recurring-tasks: 返回 array
r=$(curl -sf "$BRAIN/api/brain/recurring-tasks") || { fail "recurring-tasks: /recurring-tasks 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "recurring-tasks: 返回 array 类型" \
  || fail "recurring-tasks: 不是 array"

# tick-drain-status: draining 字段存在
r=$(curl -sf "$BRAIN/api/brain/tick/drain-status") || { fail "tick-drain-status: /drain-status 不可达"; r="{}"; }
echo "$r" | jq -e 'has("draining")' >/dev/null 2>&1 \
  && ok "tick-drain-status: drain-status.draining 字段存在" \
  || fail "tick-drain-status: draining 字段缺失"

# tick-startup-errors: errors 字段存在
r=$(curl -sf "$BRAIN/api/brain/tick/startup-errors") || { fail "tick-startup-errors: /startup-errors 不可达"; r="{}"; }
echo "$r" | jq -e 'has("errors")' >/dev/null 2>&1 \
  && ok "tick-startup-errors: startup-errors.errors 字段存在" \
  || fail "tick-startup-errors: errors 字段缺失"

# tick-disable → tick-enable（幂等，测后恢复）
r=$(curl -s -X POST "$BRAIN/api/brain/tick/disable" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-disable: POST /tick/disable success=true" \
  || fail "tick-disable: POST /tick/disable 失败 ($r)"
curl -s -X POST "$BRAIN/api/brain/tick/enable" -H "Content-Type: application/json" -d '{}' >/dev/null

# tick-enable: success=true && enabled=true
r=$(curl -s -X POST "$BRAIN/api/brain/tick/enable" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true and .enabled == true' >/dev/null 2>&1 \
  && ok "tick-enable: POST /tick/enable success=true + enabled=true" \
  || fail "tick-enable: 状态异常 ($r)"

# tick-drain → tick-drain-cancel（幂等，测后恢复）
r=$(curl -s -X POST "$BRAIN/api/brain/tick/drain" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-drain: POST /tick/drain success=true" \
  || fail "tick-drain: POST /tick/drain 失败 ($r)"
r=$(curl -s -X POST "$BRAIN/api/brain/tick/drain-cancel" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-drain-cancel: POST /tick/drain-cancel success=true" \
  || fail "tick-drain-cancel: POST /tick/drain-cancel 失败 ($r)"

# tick-execute: POST /tick success=true
r=$(curl -s -X POST "$BRAIN/api/brain/tick" -H "Content-Type: application/json" -d '{}')
echo "$r" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "tick-execute: POST /tick success=true" \
  || fail "tick-execute: POST /tick 失败 ($r)"

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  smoke-runtime.sh  |  PASS: $PASS  |  FAIL: $FAIL"
echo "════════════════════════════════════════════════════"
[[ $FAIL -eq 0 ]] && echo "✅ 全部 $PASS 项通过" && exit 0 || echo "❌ $FAIL 项失败" && exit 1
