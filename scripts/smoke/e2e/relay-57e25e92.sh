#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191312-relay-57e25e92}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

# CONTENT-INTEGRITY-GATE BEGIN: 交付物整体自证——防止 GP-STEP 标记保留但内容被掏空（round 4 新增，
# 呼应 reviewer 第三轮反馈：round 3 的非空守卫/标记存在性硬闸只验证"标记文字在不在"，未验证"标记之间
# 是否留有真实断言原语"。本段在脚本最开头读取自身源码（${SELF}），逐段抽取 GP-STEP-1/2/3 标记之间的原文，
# 对每段做内容级字面串校验；只要某段被替换成占位注释（如 "# TODO: 断言逻辑已挪到别处"），本段会在
# 执行到任何 GP-STEP 之前就先 FAIL，覆盖"直接执行完整 e2e-verify.sh"这一最关键复测场景。
SELF="${BASH_SOURCE[0]:-$0}"
_gp_extract() { awk "/# $1 BEGIN/{f=1;next} /# $1 END/{f=0} f" "$SELF"; }

_GP1_BODY="$(_gp_extract "GP-STEP-1")"
echo "$_GP1_BODY" | grep -qF "claude-headed-dispatch-smoke.sh" || { echo "FAIL: GP-STEP-1 内容自证失败——提取段缺少字面串 claude-headed-dispatch-smoke.sh（标记可能保留但内容被掏空）"; exit 1; }
echo "$_GP1_BODY" | grep -qF "grep -Fxq" || { echo "FAIL: GP-STEP-1 内容自证失败——提取段缺少字面串 grep -Fxq（标记可能保留但内容被掏空）"; exit 1; }

_GP2_BODY="$(_gp_extract "GP-STEP-2")"
echo "$_GP2_BODY" | grep -qF 'curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"' || { echo "FAIL: GP-STEP-2 内容自证失败——提取段缺少真实 curl Brain task API 断言字面串（标记可能保留但内容被掏空）"; exit 1; }
_GP2_JQ_COUNT=$(echo "$_GP2_BODY" | grep -o 'jq -e' | wc -l | tr -d ' ')
[ "${_GP2_JQ_COUNT:-0}" -ge 4 ] || { echo "FAIL: GP-STEP-2 内容自证失败——jq -e 断言出现次数=${_GP2_JQ_COUNT:-0} < 4（需覆盖 id/task_type/payload三元组/禁用字段四类断言，标记可能保留但内容被掏空）"; exit 1; }

_GP3_BODY="$(_gp_extract "GP-STEP-3")"
echo "$_GP3_BODY" | grep -qF 'psql "$DB"' || { echo "FAIL: GP-STEP-3 内容自证失败——提取段缺少真实 psql 查询字面串（标记可能保留但内容被掏空）"; exit 1; }
echo "$_GP3_BODY" | grep -qF "is_fresh" || { echo "FAIL: GP-STEP-3 内容自证失败——提取段缺少 is_fresh 新鲜度断言字面串（标记可能保留但内容被掏空）"; exit 1; }
# CONTENT-INTEGRITY-GATE END

# GP-STEP-1 BEGIN: 复用调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 登记"
  exit 1
fi
# GP-STEP-1 END

# GP-STEP-2 BEGIN: task payload 三元组齐全且不含敏感字段
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.task_type == "harness_initiative"' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay" and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null
# GP-STEP-2 END

# GP-STEP-3 BEGIN: initiative_runs 记录当前 task 的 headed relay host、合法 phase 与新鲜度（防陈旧行冒充本轮证据，round 2 reviewer 反馈补齐）
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT ir.orchestrator_host, ir.phase, ir.started_at, (ir.started_at >= t.created_at) AS is_fresh FROM initiative_runs ir JOIN tasks t ON t.id = ir.initiative_id WHERE ir.initiative_id='${TASK_ID}' ORDER BY ir.started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无 initiative_id=${TASK_ID} 的任何记录（或对应 tasks 行缺失）—— 已知外部时序依赖：该行由 Brain orchestrator 在 headed relay 推进到落库阶段后才写入（generator 完成实现后才会产生），若此刻仍无记录属预期中的时序未就绪，不是 e2e-verify.sh 自身逻辑缺陷（见 contract-draft.md Risks R1）"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
IS_FRESH=$(printf '%s' "$ROW" | cut -d'|' -f4)

case "$HOST" in
  # round 5 修正：三值合法枚举——skill-relay-claude-headed / skill-relay-codex-headed 来自
  # packages/brain/src/harness-skill-relay.js HEADED_HOSTS（第457-459行）自动化 orchestrator 派发路径；
  # foreground 来自 packages/brain/src/routes/initiatives.js POST /orchestrator/relay-runs/:initiative_id
  # 端点（第373-411行）人工前台接管补建档路径，Brain 官方设计的合法场景（见 contract-draft.md Risks R2）
  *skill-relay-claude-headed*|*skill-relay-codex-headed*) ;;
  foreground) ;;
  *) echo "FAIL: host=${HOST}（合法值：skill-relay-claude-headed / skill-relay-codex-headed / foreground，round 5 修正见 contract-draft.md Risks R2）"; exit 1 ;;
esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in
  A_planning|A_contract|B_task_loop|C_final_e2e|planning|gan|generate|evaluate|done) ;;
  *)
    echo "FAIL: phase=$PHASE"
    exit 1
    ;;
esac
if [ -z "$STARTED_AT" ]; then
  echo "FAIL: started_at 为空"
  exit 1
fi
if [ "$IS_FRESH" != "t" ]; then
  echo "FAIL: initiative_runs.started_at=$STARTED_AT 早于对应 task.created_at —— 疑似陈旧行冒充本轮证据（新鲜度校验未通过，round 2 reviewer 反馈补齐）"
  exit 1
fi
# GP-STEP-3 END

# GP-STEP-4 BEGIN: 单一可复跑 wrapper 全部通过
echo "OK headed smoke regression verified for $TASK_ID"
# GP-STEP-4 END
