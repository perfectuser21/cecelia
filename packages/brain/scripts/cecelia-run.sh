#!/usr/bin/env bash
# Cecelia-Run: 无头执行器（Stop Hook 驱动）
#
# 用法:
#   cecelia-run <task_id> <checkpoint_id> <prompt_file>
#
# 环境变量:
#   MAX_CONCURRENT - 最大并发数 (默认 8)
#   WEBHOOK_URL    - 完成后回调的 webhook URL
#   LOCK_DIR       - 锁目录 (默认 /tmp/cecelia-locks)
#
# 循环控制：由 Stop Hook (.dev-mode) 实现
#   - Stop Hook 检测 .dev-mode 文件
#   - PR 未合并 → exit 2 → claude 自动继续
#   - PR 已合并 → exit 0 → claude 正常结束
#   - CECELIA_HEADLESS=true 时 Stop Hook exit 0，由本脚本外层循环控制

set -euo pipefail

# 配置
# 并发槽位数：只看 CECELIA_MAX_CONCURRENT（旧 bridge 可能传 MAX_CONCURRENT=3，忽略）
MAX_CONCURRENT="${CECELIA_MAX_CONCURRENT:-12}"
LOCK_DIR="${LOCK_DIR:-/tmp/cecelia-locks}"
# Callback 强制指向 Brain（旧 bridge 传错误的 n8n URL，忽略）
WEBHOOK_URL="http://localhost:5221/api/brain/execution-callback"
WEBHOOK_TOKEN="${CECELIA_WEBHOOK_TOKEN:-}"
LOG_FILE="${CECELIA_LOG_FILE:-$HOME/logs/cecelia-run.log}"
WORK_DIR="${CECELIA_WORK_DIR:-/home/xx/perfect21/cecelia/core}"
MAX_RETRIES="${CECELIA_MAX_RETRIES:-5}"

# 确保日志目录存在
mkdir -p "$(dirname "$LOG_FILE")"

# 参数验证
TASK_ID="${1:?用法: cecelia-run <task_id> <checkpoint_id> <prompt_file>}"
CHECKPOINT_ID="${2:?checkpoint_id 必需}"
PROMPT_FILE="${3:?prompt_file 必需}"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo '{"success":false,"error":"Prompt file not found: '"$PROMPT_FILE"'"}' >&2
  exit 1
fi

mkdir -p "$LOCK_DIR"

# 清理僵尸任务（闲置超过 10 分钟的）+ 清理空 slot 目录
cleanup_zombies() {
  local idle_threshold=600
  for slot_dir in "$LOCK_DIR"/slot-*/; do
    [[ -d "$slot_dir" ]] || continue

    # 空目录（info.json 丢失）→ 死锁，直接清理
    if [[ ! -f "$slot_dir/info.json" ]]; then
      rmdir "$slot_dir" 2>/dev/null || rm -rf "$slot_dir"
      continue
    fi

    local pid=$(jq -r '.pid' "$slot_dir/info.json" 2>/dev/null)
    local task_id=$(jq -r '.task_id' "$slot_dir/info.json" 2>/dev/null)

    # 进程已死
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$slot_dir"
      continue
    fi

    # 检查闲置时间
    local log_file="/tmp/cecelia-${task_id}.log"
    if [[ -f "$log_file" ]]; then
      local last_mod=$(stat -c %Y "$log_file" 2>/dev/null)
      local now=$(date +%s)
      local idle=$((now - last_mod))
      local cpu=$(ps -p "$pid" -o %cpu --no-headers 2>/dev/null | tr -d ' ')
      if [[ "${cpu:-0}" == "0.0" ]] && [[ $idle -gt $idle_threshold ]]; then
        kill -9 "$pid" 2>/dev/null
        rm -rf "$slot_dir"
      fi
    fi
  done
}

# 获取并发锁（等待直到有空位，超时退出）
MAX_LOCK_WAIT="${CECELIA_MAX_LOCK_WAIT:-300}"  # 最多等 5 分钟

get_lock() {
  cleanup_zombies

  # 去重：同一 task_id 已在运行 → 直接退出
  for slot_dir in "$LOCK_DIR"/slot-*/; do
    [[ -d "$slot_dir" ]] || continue
    if [[ -f "$slot_dir/info.json" ]]; then
      local existing_task existing_pid
      existing_task=$(jq -r '.task_id' "$slot_dir/info.json" 2>/dev/null)
      existing_pid=$(jq -r '.pid' "$slot_dir/info.json" 2>/dev/null)
      if [[ "$existing_task" == "$TASK_ID" ]] && kill -0 "$existing_pid" 2>/dev/null; then
        echo "[cecelia-run] task=$TASK_ID 已在 slot $(basename "$slot_dir") 运行 (pid=$existing_pid)，跳过重复派发" >&2
        exit 0
      fi
    fi
  done

  local wait_count=0
  while true; do
    for i in $(seq 1 "$MAX_CONCURRENT"); do
      slot="$LOCK_DIR/slot-$i"
      if mkdir "$slot" 2>/dev/null; then
        echo "{\"task_id\":\"$TASK_ID\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"mode\":\"headless\",\"pid\":$$,\"started\":\"$(date -Iseconds)\"}" > "$slot/info.json"
        echo "$slot"
        return 0
      fi
    done
    wait_count=$((wait_count + 1))
    if [[ $wait_count -ge $MAX_LOCK_WAIT ]]; then
      echo "[cecelia-run] ❌ 等待锁超时 (${MAX_LOCK_WAIT}s), task=$TASK_ID" >&2
      exit 1
    fi
    if [[ $((wait_count % 30)) -eq 0 ]]; then
      cleanup_zombies
      echo "[cecelia-run] 等待并发锁... (已等 ${wait_count}s, task=$TASK_ID)" >&2
    fi
    sleep 1
  done
}

# 释放锁（必须确保目录被删除，否则造成死锁）
release_lock() {
  if [[ -n "${1:-}" && -d "$1" ]]; then
    rm -f "$1/info.json" 2>/dev/null || true
    rmdir "$1" 2>/dev/null || rm -rf "$1" 2>/dev/null || true
  fi
}

# 写入结构化日志
log_execution() {
  local status="$1"
  local exit_code="$2"
  local duration="$3"
  local slot_name="$4"
  local attempt="$5"

  local slot_num
  slot_num=$(basename "$slot_name" 2>/dev/null || echo "unknown")

  local log_entry
  log_entry=$(jq -n \
    --arg ts "$(date -Iseconds)" \
    --arg task_id "$TASK_ID" \
    --arg checkpoint_id "$CHECKPOINT_ID" \
    --arg status "$status" \
    --argjson exit_code "$exit_code" \
    --argjson duration_ms "$duration" \
    --arg slot "$slot_num" \
    --arg pid "$$" \
    --argjson attempt "$attempt" \
    '{timestamp: $ts, task_id: $task_id, checkpoint_id: $checkpoint_id, status: $status, exit_code: $exit_code, duration_ms: $duration_ms, slot: $slot, pid: $pid, attempt: $attempt}' 2>/dev/null \
    || echo "{\"timestamp\":\"$(date -Iseconds)\",\"task_id\":\"$TASK_ID\",\"status\":\"$status\"}")

  echo "$log_entry" >> "$LOG_FILE"
}

# 发送 webhook 回调
send_webhook() {
  local status="$1"
  local result_file="$2"
  local error_file="$3"
  local duration="$4"
  local attempt="$5"

  if [[ -z "$WEBHOOK_URL" ]]; then
    return 0
  fi

  local payload
  if command -v jq >/dev/null 2>&1; then
    local result_json
    if [[ -f "$result_file" ]] && jq -e . "$result_file" >/dev/null 2>&1; then
      result_json=$(cat "$result_file")
    else
      result_json='null'
    fi

    local stderr_content=""
    if [[ -f "$error_file" ]]; then
      stderr_content=$(tail -c 4000 "$error_file" | sed 's/"/\\"/g' | tr '\n' ' ')
    fi

    payload=$(jq -n \
      --arg task_id "$TASK_ID" \
      --arg checkpoint_id "$CHECKPOINT_ID" \
      --arg run_id "$CHECKPOINT_ID" \
      --arg status "$status" \
      --argjson result "$result_json" \
      --arg stderr "$stderr_content" \
      --argjson duration "$duration" \
      --argjson attempt "$attempt" \
      '{
        task_id: $task_id,
        checkpoint_id: $checkpoint_id,
        run_id: $run_id,
        status: $status,
        result: $result,
        stderr: $stderr,
        duration_ms: $duration,
        attempt: $attempt,
        coding_type: "cecelia",
        timestamp: now | todate
      }')
  else
    payload="{\"task_id\":\"$TASK_ID\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"run_id\":\"$CHECKPOINT_ID\",\"status\":\"$status\",\"coding_type\":\"cecelia\",\"duration_ms\":$duration,\"attempt\":$attempt}"
  fi

  if [[ -n "$WEBHOOK_TOKEN" ]]; then
    curl -sS -X POST \
      -H "Content-Type: application/json" \
      -H "X-Cecilia-Token: $WEBHOOK_TOKEN" \
      -d "$payload" \
      "$WEBHOOK_URL" >/dev/null 2>&1 || true
  else
    curl -sS -X POST \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

# 主逻辑
main() {
  local start_time end_time duration
  start_time=$(date +%s%3N)

  # 获取锁
  SLOT="$(get_lock)"
  CLEANUP_WORKTREE=""
  CHILD_PID=""

  CHILD_PGID=""

  # 清理函数：释放锁 + 杀进程组 + 清理 worktree
  cleanup() {
    local pgid=${CHILD_PGID:-$CHILD_PID}
    if [[ -n "$pgid" ]] && [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
      kill -TERM -"$pgid" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null
      sleep 2
      if kill -0 "$CHILD_PID" 2>/dev/null; then
        kill -9 -"$pgid" 2>/dev/null || kill -9 "$CHILD_PID" 2>/dev/null
      fi
    fi
    release_lock "$SLOT"
    [[ -n "$CLEANUP_WORKTREE" ]] && git -C "$WORK_DIR" worktree remove "$CLEANUP_WORKTREE" --force 2>/dev/null || true
  }
  trap cleanup EXIT

  # Permission mode: plan = 只读/Plan Mode, bypassPermissions = 完全自动化
  local PERMISSION_MODE="${CECELIA_PERMISSION_MODE:-bypassPermissions}"
  local TASK_TYPE="${CECELIA_TASK_TYPE:-dev}"
  local MODEL="${CECELIA_MODEL:-}"
  local MODEL_FLAG=""
  if [[ -n "$MODEL" ]]; then
    MODEL_FLAG="--model $MODEL"
  fi

  # Provider 注入：CECELIA_PROVIDER=minimax 时覆盖 Anthropic，走 MiniMax API
  local PROVIDER_ENV=""
  # CECELIA_CREDENTIALS: 通用账户选择（所有 provider 适用）
  # CECELIA_MINIMAX_CREDENTIALS: 旧版向后兼容
  local CRED_NAME="${CECELIA_CREDENTIALS:-${CECELIA_MINIMAX_CREDENTIALS:-}}"

  if [[ "${CECELIA_PROVIDER:-}" == "minimax" ]]; then
    local MINIMAX_CRED="${CRED_NAME:-minimax}"
    local MINIMAX_KEY
    MINIMAX_KEY=$(python3 -c "import json; d=json.load(open('/home/xx/.credentials/${MINIMAX_CRED}.json')); print(d['api_key'])" 2>/dev/null)
    if [[ -n "$MINIMAX_KEY" ]]; then
      # 官方文档：所有模型别名均设为 MiniMax-M2.5（https://platform.minimax.io/docs/coding-plan/claude-code）
      local MM_MODEL="MiniMax-M2.5"
      PROVIDER_ENV="ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic ANTHROPIC_AUTH_TOKEN=$MINIMAX_KEY ANTHROPIC_MODEL=$MM_MODEL ANTHROPIC_SMALL_FAST_MODEL=$MM_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL=$MM_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL=$MM_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL=$MM_MODEL"
      echo "[cecelia-run] Provider: MiniMax cred=${MINIMAX_CRED} model=${MM_MODEL}" >&2
    else
      echo "[cecelia-run] WARN: MiniMax key not found in ${MINIMAX_CRED}.json, falling back to Anthropic" >&2
    fi
  elif [[ "$CRED_NAME" =~ ^account([0-9]+)$ ]]; then
    # Anthropic OAuth 账户：使用 CLAUDE_CONFIG_DIR 隔离，Claude 自动管理 token 刷新
    local ACCOUNT_NUM="${BASH_REMATCH[1]}"
    local ACCOUNT_DIR="$HOME/.claude-account${ACCOUNT_NUM}"
    if [[ -d "$ACCOUNT_DIR" ]]; then
      PROVIDER_ENV="CLAUDE_CONFIG_DIR=${ACCOUNT_DIR}"
      echo "[cecelia-run] Provider: Anthropic OAuth cred=${CRED_NAME} (CLAUDE_CONFIG_DIR=${ACCOUNT_DIR})" >&2
    else
      echo "[cecelia-run] WARN: 账号目录 ${ACCOUNT_DIR} 不存在，falling back to default" >&2
    fi
  elif [[ -n "$CRED_NAME" && "$CRED_NAME" != "anthropic" && "$CRED_NAME" != "account1" && -f "/home/xx/.credentials/${CRED_NAME}.json" ]]; then
    # Anthropic 多账户：从 credentials 文件读取 API key
    local ANTHROPIC_KEY
    ANTHROPIC_KEY=$(python3 -c "import json; d=json.load(open('/home/xx/.credentials/${CRED_NAME}.json')); print(d['api_key'])" 2>/dev/null)
    if [[ -n "$ANTHROPIC_KEY" ]]; then
      PROVIDER_ENV="ANTHROPIC_API_KEY=$ANTHROPIC_KEY"
      echo "[cecelia-run] Provider: Anthropic cred=${CRED_NAME}" >&2
    fi
  fi
  # Skill context env: 收集 CECELIA_SKILLENV_* 变量，拼入 PROVIDER_ENV 传给 claude 进程
  # 例如 CECELIA_SKILLENV_SKILL_CONTEXT=code_review → claude 进程看到 SKILL_CONTEXT=code_review
  for skillenv_var in $(compgen -v | grep '^CECELIA_SKILLENV_' 2>/dev/null || true); do
    local skillenv_key="${skillenv_var#CECELIA_SKILLENV_}"
    local skillenv_val="${!skillenv_var}"
    if [[ -n "$skillenv_key" && -n "$skillenv_val" ]]; then
      PROVIDER_ENV="${PROVIDER_ENV:+$PROVIDER_ENV }${skillenv_key}=${skillenv_val}"
      echo "[cecelia-run] Injecting env: ${skillenv_key}=${skillenv_val}" >&2
    fi
  done

  # Max turns: 0 = 不限制（不传 --max-turns 参数），其他值 = 上限
  local MAX_TURNS="${CECELIA_MAX_TURNS:-${CECELIA_SKILLENV_CECELIA_MAX_TURNS:-0}}"
  local MAX_TURNS_FLAG=""
  if [ "$MAX_TURNS" != "0" ]; then
    MAX_TURNS_FLAG="--max-turns $MAX_TURNS"
  fi
  echo "[cecelia-run] 开始执行 task=$TASK_ID checkpoint=$CHECKPOINT_ID type=$TASK_TYPE mode=$PERMISSION_MODE${MODEL:+ model=$MODEL}" >&2

  # 注册 run 到 Core API（让 Dashboard 能看到）
  local CORE_API="${CECELIA_CORE_API:-http://localhost:5212}"
  local task_title
  task_title=$(curl -s "$CORE_API/api/tasks/tasks" 2>/dev/null | jq -r --arg id "$TASK_ID" '.[] | select(.id == $id) | .title // empty' 2>/dev/null || echo "")
  curl -s -X POST "$CORE_API/api/cecelia/runs" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg prd_path ".prd.md" \
      --arg project "cecelia-workspace" \
      --arg branch "cp-${TASK_ID:0:8}" \
      --arg title "${task_title:-Task $TASK_ID}" \
      --arg id "$CHECKPOINT_ID" \
      '{prd_path: $prd_path, project: $project, feature_branch: $branch, total_checkpoints: 11, prd_title: $title, id: $id}')" \
    >/dev/null 2>&1 || true

  # 读取 prompt
  local original_prompt
  original_prompt=$(cat "$PROMPT_FILE")

  # 准备输出文件
  local out_json err_log
  out_json=$(mktemp "/tmp/cecelia-out.${TASK_ID}.XXXXXX.json")
  err_log=$(mktemp "/tmp/cecelia-err.${TASK_ID}.XXXXXX.log")

  # 自动创建 worktree 隔离（无头模式必须隔离，避免和有头会话冲突）
  # 安全原则：worktree 失败 → 中止任务，绝不降级到主仓库
  local ACTUAL_WORK_DIR=""
  local task_slug
  task_slug=$(echo "${task_title:-$TASK_ID}" | sed 's/[^a-zA-Z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-30 | sed 's/-$//')
  task_slug="${task_slug:-task-$TASK_ID}"

  local WORKTREE_SCRIPT="$HOME/.claude/skills/dev/scripts/worktree-manage.sh"

  # worktree-manage.sh 不存在 → 中止
  if [[ ! -f "$WORKTREE_SCRIPT" ]]; then
    echo "[cecelia-run] ❌ worktree-manage.sh 不存在 ($WORKTREE_SCRIPT)，中止任务" >&2
    local abort_end abort_duration
    abort_end=$(date +%s%3N)
    abort_duration=$((abort_end - start_time))
    echo "worktree_script_missing" > "$err_log"
    send_webhook "AI Failed" "$out_json" "$err_log" "$abort_duration" "1"
    rm -f "$out_json" "$err_log" 2>/dev/null || true
    exit 1
  fi

  local wt_path wt_stderr_log
  wt_stderr_log=$(mktemp "/tmp/cecelia-wt-err.${TASK_ID}.XXXXXX.log")
  wt_path=$(cd "$WORK_DIR" && bash "$WORKTREE_SCRIPT" create "$task_slug" 2>"$wt_stderr_log" | tail -1) || true

  if [[ -n "$wt_path" && -d "$wt_path" ]]; then
    ACTUAL_WORK_DIR="$wt_path"
    CLEANUP_WORKTREE="$wt_path"
    echo "[cecelia-run] Worktree 创建成功: $ACTUAL_WORK_DIR" >&2
    rm -f "$wt_stderr_log" 2>/dev/null || true
  else
    # 安全中止：绝不在主仓库运行，防止污染有头会话
    echo "[cecelia-run] ❌ Worktree 创建失败，中止任务（安全保护：拒绝在主仓库运行）" >&2
    echo "[cecelia-run] Worktree 错误详情:" >&2
    cat "$wt_stderr_log" >&2 2>/dev/null || true
    rm -f "$wt_stderr_log" 2>/dev/null || true
    local abort_end abort_duration
    abort_end=$(date +%s%3N)
    abort_duration=$((abort_end - start_time))
    echo "worktree_creation_failed: $(cat "$wt_stderr_log" 2>/dev/null | head -3 || echo 'unknown error')" > "$err_log"
    send_webhook "AI Failed" "$out_json" "$err_log" "$abort_duration" "1"
    rm -f "$out_json" "$err_log" 2>/dev/null || true
    exit 1
  fi

  # 执行：Stop Hook 控制循环，失败时外层重试
  local attempt=1
  local exit_code=0

  while [[ $attempt -le $MAX_RETRIES ]]; do
    echo "[cecelia-run] Attempt $attempt/$MAX_RETRIES" >&2

    # claude -p 执行，setsid 隔离进程组 + wait 获取 PID
    # CRITICAL: unset CLAUDECODE to allow nested sessions (bypass check)
    set +e
    if [[ "$PERMISSION_MODE" == "plan" ]]; then
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV claude -p \"\$1\" --permission-mode plan $MODEL_FLAG $MAX_TURNS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" &
    else
        echo "[cecelia-run] DEBUG: 启动 claude 进程..." >&2
      echo "[cecelia-run] DEBUG: WORK_DIR=$ACTUAL_WORK_DIR" >&2
      echo "[cecelia-run] DEBUG: MODEL_FLAG=$MODEL_FLAG" >&2
      echo "[cecelia-run] DEBUG: PROMPT=${original_prompt:0:200}..." >&2
      setsid bash -c "cd '$ACTUAL_WORK_DIR' && unset CLAUDECODE && CECELIA_HEADLESS=true $PROVIDER_ENV claude -p \"\$1\" --dangerously-skip-permissions $MODEL_FLAG $MAX_TURNS_FLAG --output-format json >\"$out_json\" 2>\"$err_log\"" _ "$original_prompt" &
    fi
    CHILD_PID=$!

    # 获取 setsid 创建的 PGID（等进程稳定）
    sleep 0.2
    CHILD_PGID=$(ps -o pgid= -p "$CHILD_PID" 2>/dev/null | tr -d ' ')
    CHILD_PGID=${CHILD_PGID:-$CHILD_PID}

    # 更新 info.json 加入 pgid + child_pid（原子写：tmp→mv）
    if [[ -f "$SLOT/info.json" ]]; then
      local tmp_info
      tmp_info=$(mktemp)
      if jq --argjson cpid "$CHILD_PID" --argjson pgid "${CHILD_PGID}" \
        '. + {child_pid: $cpid, pgid: $pgid}' "$SLOT/info.json" > "$tmp_info" 2>/dev/null; then
        mv "$tmp_info" "$SLOT/info.json"
      else
        rm -f "$tmp_info" 2>/dev/null
      fi
    fi

    echo "[cecelia-run] DEBUG: 等待进程 $CHILD_PID 完成..." >&2
    wait "$CHILD_PID"
    exit_code=$?
    echo "[cecelia-run] DEBUG: 进程退出，exit_code=$exit_code" >&2
    CHILD_PID=""
    CHILD_PGID=""
    set -e

    # exit 0 = 成功完成（PR 合并或任务完成）
    if [[ $exit_code -eq 0 ]]; then
      echo "[cecelia-run] ✅ 执行成功" >&2
      break
    fi

    # exit 2 = Stop Hook 要求继续（不应该在 HEADLESS 模式出现，但保底处理）
    if [[ $exit_code -eq 2 ]]; then
      echo "[cecelia-run] Stop Hook 要求继续，重试..." >&2
      attempt=$((attempt + 1))
      sleep 2
      continue
    fi

    # 其他错误 = 真正失败
    echo "[cecelia-run] ❌ 执行失败 exit_code=$exit_code" >&2
    break
  done

  end_time=$(date +%s%3N)
  duration=$((end_time - start_time))

  # 确定最终状态
  local status
  if [[ $exit_code -eq 0 ]]; then
    status="AI Done"
    echo "[cecelia-run] 执行完成 task=$TASK_ID attempt=$attempt duration=${duration}ms" >&2
  elif [[ $attempt -gt $MAX_RETRIES ]]; then
    status="AI Failed"
    echo "[cecelia-run] 达到最大重试次数 task=$TASK_ID attempts=$attempt" >&2
    exit_code=1
  else
    status="AI Failed"
    echo "[cecelia-run] 执行失败 task=$TASK_ID exit_code=$exit_code attempt=$attempt" >&2
  fi

  # 更新 Core API run 状态
  local run_status="failed"
  [[ $exit_code -eq 0 ]] && run_status="completed"
  curl -s -X PATCH "$CORE_API/api/cecelia/runs/$CHECKPOINT_ID/status" \
    -H "Content-Type: application/json" \
    -d "{\"current_action\":\"$status\",\"step_status\":\"$run_status\"}" \
    >/dev/null 2>&1 || true

  # 更新 Core DB task status（关键！否则 Brain tick 会 auto-fail-timeout）
  local task_status="failed"
  [[ $exit_code -eq 0 ]] && task_status="completed"
  curl -s -X POST "$CORE_API/api/brain/action/update-task" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_ID\",\"status\":\"$task_status\",\"idempotency_key\":\"cecelia-run-${TASK_ID}-${CHECKPOINT_ID}\"}" \
    --max-time 5 >/dev/null 2>&1 || true

  # 触发本地部署（PR 合并后自动重启服务）
  # 在 send_webhook 之前执行：此时 worktree 还未 fetch，origin/main 是合并前状态，
  # git diff origin/main..HEAD 能正确得到本次 PR 的改动文件列表。
  if [[ $exit_code -eq 0 && "${TASK_TYPE:-dev}" == "dev" ]]; then
    DEPLOY_CHANGED=$(cd "$ACTUAL_WORK_DIR" && git diff --name-only "origin/main..HEAD" 2>/dev/null || echo "")
    # apps/api/** 被 dashboard vite alias 引用，改动同样需要重建 dashboard
    if echo "$DEPLOY_CHANGED" | grep -q "^packages/brain/\|^apps/dashboard/\|^apps/api/"; then
      # 找主仓库根目录（worktree 的 git-common-dir 指向主仓库 .git）
      GIT_COMMON=$(cd "$ACTUAL_WORK_DIR" && git rev-parse --git-common-dir 2>/dev/null || echo ".git")
      if [[ "$GIT_COMMON" == ".git" ]]; then
        REPO_ROOT="$(cd "$ACTUAL_WORK_DIR" && git rev-parse --show-toplevel 2>/dev/null || echo "")"
      else
        REPO_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
      fi
      DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy-local.sh"
      if [[ -n "$REPO_ROOT" && -f "$DEPLOY_SCRIPT" ]]; then
        echo "[cecelia-run] 检测到需要部署的改动，触发 deploy-local.sh (fire-and-forget)" >&2
        setsid bash "$DEPLOY_SCRIPT" main --changed="$DEPLOY_CHANGED" \
          >"/tmp/cecelia-deploy-${TASK_ID}.log" 2>&1 &
        echo "[cecelia-run] 部署已启动 (pid=$!，日志: /tmp/cecelia-deploy-${TASK_ID}.log)" >&2
      else
        echo "[cecelia-run] WARN: deploy-local.sh 不存在 ($DEPLOY_SCRIPT)，跳过部署" >&2
      fi
    fi
  fi

  # 发送 webhook 回调
  send_webhook "$status" "$out_json" "$err_log" "$duration" "$attempt"

  # 写入结构化日志
  log_execution "$status" "$exit_code" "$duration" "$SLOT" "$attempt"

  # 输出结果到 stdout
  if [[ -f "$out_json" ]]; then
    cat "$out_json"
  fi

  # 清理临时文件
  rm -f "$out_json" "$err_log" 2>/dev/null || true

  exit $exit_code
}

main
