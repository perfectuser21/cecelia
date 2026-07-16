#!/usr/bin/env bash
# dispatch-worker.sh — 跨账号 worker 派工脚本（controller 派工基建 v1）
#
# 用法:
#   dispatch-worker.sh [OPTIONS] <task_doc> <work_dir>
#
# OPTIONS:
#   --vendor <codex|claude|grok|auto>  指定 vendor（默认 auto = Brain 推荐账号最优 vendor）
#   --max-retries <N>                  最大重试次数（默认 3）
#   --timeout <seconds>                单次 worker 超时（默认 600）
#   --output-file <path>               结果 JSON 写入文件（默认 stdout）
#   --dry-run                          只打印派发命令，不实际执行
#
# 输出 JSON（stdout 或 --output-file）:
#   { "ok": true,  "account": "account2", "vendor": "claude", "attempts": 1, "output": "..." }
#   { "ok": false, "account": "team1",    "vendor": "codex",  "attempts": 3, "error": "quota exhausted" }
#
# 退出码:
#   0 = 成功
#   1 = 所有账号均失败
#   2 = 参数错误

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
MAX_RETRIES=3
TIMEOUT_SECS=600
VENDOR="auto"
OUTPUT_FILE=""
DRY_RUN=0

# ── 参数解析 ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vendor)       VENDOR="$2";      shift 2 ;;
    --max-retries)  MAX_RETRIES="$2"; shift 2 ;;
    --timeout)      TIMEOUT_SECS="$2"; shift 2 ;;
    --output-file)  OUTPUT_FILE="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1;        shift   ;;
    --*)            echo "[dispatch-worker] 未知选项: $1" >&2; exit 2 ;;
    *)              break ;;
  esac
done

TASK_DOC="${1:?用法: dispatch-worker.sh [OPTIONS] <task_doc> <work_dir>}"
WORK_DIR="${2:?work_dir 必需}"

if [[ ! -f "$TASK_DOC" ]]; then
  echo "[dispatch-worker] task_doc 不存在: $TASK_DOC" >&2
  exit 2
fi
if [[ ! -d "$WORK_DIR" ]]; then
  echo "[dispatch-worker] work_dir 不存在: $WORK_DIR" >&2
  exit 2
fi

# ── 工具函数 ──────────────────────────────────────────────
log() { echo "[dispatch-worker] $*" >&2; }

json_out() {
  local json="$1"
  if [[ -n "$OUTPUT_FILE" ]]; then
    echo "$json" > "$OUTPUT_FILE"
  else
    echo "$json"
  fi
}

# ── 额度撞墙检测 regex ────────────────────────────────────
# Claude:  "Usage limit reached" / "rate_limit_error" / "overloaded_error" / "credit balance"
# Codex:   "429" / "rate limit" / "usage_limit_exceeded" / "You have exceeded" / "quota exceeded"
# Grok:    "rate_limit_exceeded" / "429" / "quota_exceeded"
QUOTA_WALL_RE='Usage limit reached|rate_limit_error|overloaded_error|credit balance|Your account has reached|429 Too Many|rate limit exceeded|usage_limit_exceeded|You have exceeded|quota_exceeded|Rate limit|Rate Limit|Too Many Requests'

output_hits_quota_wall() {
  local text="$1"
  echo "$text" | grep -qEi "$QUOTA_WALL_RE"
}

# ── Claude 账号列表（Brain API → fallback 静态） ──────────
get_claude_accounts() {
  local best
  best=$(curl -sf --max-time 5 "$BRAIN_URL/api/brain/account/best" 2>/dev/null \
         | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('account',''))" 2>/dev/null || true)

  # 候选账号：先放 Brain 推荐账号，再放其他已知账号兜底
  local accounts=()
  [[ -n "$best" ]] && accounts+=("$best")
  for a in account1 account2 account3 account4; do
    [[ "$a" != "$best" ]] && accounts+=("$a")
  done
  echo "${accounts[@]}"
}

# ── Codex 账号列表（按 auth.json 存在优先） ───────────────
get_codex_accounts() {
  local accounts=()
  for n in 1 2 3 4 5; do
    local home="$HOME/.codex-team${n}"
    if [[ -f "$home/auth.json" ]]; then
      # 检查 tokens 字段存在且非空
      python3 -c "
import json, sys
try:
  d = json.load(open('$home/auth.json'))
  sys.exit(0 if d.get('tokens') else 1)
except: sys.exit(1)
" 2>/dev/null && accounts+=("team${n}")
    fi
  done
  echo "${accounts[@]}"
}

# ── Grok 账号列表（从 XAI_API_KEY / ~/.credentials/grok.env） ──
get_grok_accounts() {
  local keys=()
  # 支持 XAI_API_KEY_1 ... XAI_API_KEY_5
  for n in "" 1 2 3 4 5; do
    local var="XAI_API_KEY${n}"
    local val="${!var:-}"
    [[ -n "$val" ]] && keys+=("grok${n:-0}")
  done
  # 如果没有编号 key，尝试凭据文件
  if [[ ${#keys[@]} -eq 0 ]] && [[ -f "$HOME/.credentials/grok.env" ]]; then
    keys+=("grok0")
  fi
  echo "${keys[@]}"
}

# ── 启动单次 worker（返回 stdout 文本）───────────────────
run_claude_worker() {
  local account="$1" task_doc="$2" work_dir="$3"
  local creds_dir="$HOME/.claude/.${account}"
  local env_args=()

  # 账号凭据目录
  if [[ -d "$creds_dir" ]]; then
    env_args+=("CLAUDE_CONFIG_DIR=$creds_dir")
  fi
  env_args+=("CECELIA_CREDENTIALS=$account")

  log "claude worker → account=$account work_dir=$work_dir"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] env ${env_args[*]} claude --dangerously-skip-permissions -p \"\$(cat $task_doc)\""
    return 0
  fi

  env "${env_args[@]}" timeout "$TIMEOUT_SECS" \
    bash "${REPO_ROOT:-$(git -C "$work_dir" rev-parse --show-toplevel 2>/dev/null || echo "/workspace")}/scripts/claude-launch.sh" \
    --dangerously-skip-permissions -p "$(cat "$task_doc")" 2>&1 || true
}

run_codex_worker() {
  local account="$1" task_doc="$2" work_dir="$3"
  local team_n="${account#team}"
  local codex_home="$HOME/.codex-team${team_n}"
  local model="${CODEX_MODEL:-codex-mini-latest}"

  log "codex worker → $account (CODEX_HOME=$codex_home) work_dir=$work_dir"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] cd $work_dir && CODEX_HOME=$codex_home codex exec --skip-git-repo-check -m $model \"\$(cat $task_doc)\""
    return 0
  fi

  (cd "$work_dir" && CODEX_HOME="$codex_home" timeout "$TIMEOUT_SECS" \
    codex exec --skip-git-repo-check -m "$model" "$(cat "$task_doc")" 2>&1) || true
}

run_grok_worker() {
  local account="$1" task_doc="$2" work_dir="$3"
  local key_n="${account#grok}"
  local var="XAI_API_KEY${key_n}"
  local api_key="${!var:-}"

  # fallback 到凭据文件
  if [[ -z "$api_key" ]] && [[ -f "$HOME/.credentials/grok.env" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.credentials/grok.env" 2>/dev/null || true
    api_key="${XAI_API_KEY:-}"
  fi

  if [[ -z "$api_key" ]]; then
    log "grok: $account 无有效 API key" >&2
    echo "__QUOTA_WALL__ grok api key missing"
    return 0
  fi

  local model="${GROK_MODEL:-grok-3}"
  local prompt
  prompt=$(cat "$task_doc")

  log "grok worker → $account model=$model work_dir=$work_dir"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] curl x.ai/api → model=$model"
    return 0
  fi

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({
  'model': '$model',
  'messages': [{'role': 'user', 'content': sys.stdin.read()}],
  'stream': False
}))" <<< "$prompt" 2>/dev/null)

  timeout "$TIMEOUT_SECS" curl -sf -X POST "https://api.x.ai/v1/chat/completions" \
    -H "Authorization: Bearer $api_key" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1 \
    | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  print(d['choices'][0]['message']['content'])
except Exception as e:
  print(sys.stdin.read() if hasattr(sys.stdin, 'read') else '', file=sys.stderr)
  sys.exit(1)
" 2>&1 || true
}

# ── vendor 自动探测（Brain 推荐 claude；按现有账号 fallback） ──
resolve_vendor() {
  if [[ "$VENDOR" != "auto" ]]; then
    echo "$VENDOR"
    return
  fi
  # Brain 推荐账号非空 → claude
  local best
  best=$(curl -sf --max-time 5 "$BRAIN_URL/api/brain/account/best" 2>/dev/null \
         | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('account',''))" 2>/dev/null || true)
  [[ -n "$best" ]] && { echo "claude"; return; }

  # 检查 codex teams
  local codex_list
  codex_list=$(get_codex_accounts)
  [[ -n "$codex_list" ]] && { echo "codex"; return; }

  echo "claude"  # ultimate fallback
}

# ── 主派发循环 ────────────────────────────────────────────
RESOLVED_VENDOR=$(resolve_vendor)
log "vendor=$RESOLVED_VENDOR max_retries=$MAX_RETRIES"

case "$RESOLVED_VENDOR" in
  claude) ACCOUNTS_ARR=($(get_claude_accounts)) ;;
  codex)  ACCOUNTS_ARR=($(get_codex_accounts))  ;;
  grok)   ACCOUNTS_ARR=($(get_grok_accounts))   ;;
  *)
    echo "[dispatch-worker] 未知 vendor: $RESOLVED_VENDOR" >&2
    exit 2
  ;;
esac

if [[ ${#ACCOUNTS_ARR[@]} -eq 0 ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    # dry-run 时无真实账号 → 用占位账号展示命令，不报错
    case "$RESOLVED_VENDOR" in
      codex) ACCOUNTS_ARR=("team1") ;;
      grok)  ACCOUNTS_ARR=("grok0") ;;
      *)     ACCOUNTS_ARR=("account1") ;;
    esac
    log "dry-run: 无真实账号，使用占位 ${ACCOUNTS_ARR[0]}"
  else
    log "无可用账号（vendor=$RESOLVED_VENDOR）"
    json_out "{\"ok\":false,\"vendor\":\"$RESOLVED_VENDOR\",\"account\":null,\"attempts\":0,\"error\":\"no accounts available\"}"
    exit 1
  fi
fi

ATTEMPT=0
USED_ACCOUNT=""
LAST_OUTPUT=""
LAST_ERROR=""

for account in "${ACCOUNTS_ARR[@]}"; do
  if [[ $ATTEMPT -ge $MAX_RETRIES ]]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  USED_ACCOUNT="$account"
  log "尝试 #$ATTEMPT → $account"

  case "$RESOLVED_VENDOR" in
    claude) LAST_OUTPUT=$(run_claude_worker "$account" "$TASK_DOC" "$WORK_DIR") ;;
    codex)  LAST_OUTPUT=$(run_codex_worker  "$account" "$TASK_DOC" "$WORK_DIR") ;;
    grok)   LAST_OUTPUT=$(run_grok_worker   "$account" "$TASK_DOC" "$WORK_DIR") ;;
  esac

  if output_hits_quota_wall "$LAST_OUTPUT"; then
    log "账号 $account 额度撞墙，换下一个..."
    LAST_ERROR="quota wall on $account"
    continue
  fi

  # 成功
  local_output_escaped=$(echo "$LAST_OUTPUT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')
  json_out "{\"ok\":true,\"vendor\":\"$RESOLVED_VENDOR\",\"account\":\"$USED_ACCOUNT\",\"attempts\":$ATTEMPT,\"output\":$local_output_escaped}"
  exit 0
done

# 所有账号均失败
err_escaped=$(echo "$LAST_ERROR" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null || echo '"all accounts failed"')
json_out "{\"ok\":false,\"vendor\":\"$RESOLVED_VENDOR\",\"account\":\"$USED_ACCOUNT\",\"attempts\":$ATTEMPT,\"error\":$err_escaped}"
exit 1
