#!/usr/bin/env bash
# track.sh - /dev 流程状态跟踪
#
# 用法:
#   track.sh start <project> <feature_branch> <prd_path>   # 开始新任务
#   track.sh step <step_number> <step_name>                # 更新当前步骤
#   track.sh done [pr_url]                                 # 任务完成
#   track.sh fail <error_message>                          # 任务失败
#   track.sh status                                        # 获取当前状态
#
# 存储: 使用 .cecelia-run-id 文件保存当前 run_id
# 同时支持有头(交互式)和无头(Cecelia)模式

set -euo pipefail

# v1.1: 分支级别状态文件隔离
get_track_file() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo ".cecelia-run-id-${branch}"
}

CECELIA_API="${HOME}/bin/cecelia-api"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[TRACK]${NC} $*" >&2; }
log_warn() { echo -e "${YELLOW}[TRACK]${NC} $*" >&2; }

# 获取当前 run_id（支持分支隔离 + 向后兼容）
get_run_id() {
  local track_file
  track_file=$(get_track_file)

  # 优先读取分支级别文件
  if [[ -f "$track_file" ]]; then
    cat "$track_file"
    return
  fi

  # 向后兼容：读取旧格式文件
  if [[ -f ".cecelia-run-id" ]]; then
    cat ".cecelia-run-id"
  fi
}

# 保存 run_id（原子写入，防止并发损坏）
save_run_id() {
  local track_file tmp_file
  track_file=$(get_track_file)

  # 使用 mktemp + mv 实现原子写入
  tmp_file=$(mktemp) || return 1
  echo "$1" > "$tmp_file" || { rm -f "$tmp_file"; return 1; }
  mv "$tmp_file" "$track_file" 2>/dev/null || { rm -f "$tmp_file"; return 1; }
}

# 清理 run_id（清理分支级别文件）
clear_run_id() {
  local track_file
  track_file=$(get_track_file)
  rm -f "$track_file"

  # 同时清理旧格式（如果存在且当前分支创建的）
  # 注意：不要盲目删除旧格式，可能是其他分支的
}

# 检测是否是无头模式
is_headless() {
  [[ "${CECELIA_HEADLESS:-}" == "true" ]] || [[ -n "${CECELIA_TASK_ID:-}" ]]
}

# 检查 cecelia-api 是否可用
check_api() {
  if [[ ! -x "$CECELIA_API" ]]; then
    log_warn "cecelia-api not found at $CECELIA_API"
    return 1
  fi
  return 0
}

# 开始新任务
cmd_start() {
  local project="${1:-$(basename "$(pwd)")}"
  local feature_branch="${2:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")}"
  local prd_path="${3:-.prd.md}"
  local total_tasks="${4:-1}"

  # 检查 API
  if ! check_api; then
    return 0
  fi

  # 从 PRD 获取标题和摘要
  local prd_title=""
  local prd_summary=""
  if [[ -f "$prd_path" ]]; then
    prd_title=$(head -5 "$prd_path" | grep -E "^#" | head -1 | sed 's/^#* *//' || echo "")
    prd_summary=$(head -10 "$prd_path" | grep -v "^#" | head -2 | tr '\n' ' ' | head -c 200 || echo "")
  fi

  # 确定模式
  local mode="interactive"
  if is_headless; then
    mode="headless"
  fi

  log_info "Creating run: $project / $feature_branch (mode: $mode)"

  # 调用 cecelia-api 创建 run
  local response
  response=$("$CECELIA_API" create-run "$project" "$feature_branch" "$prd_path" "$total_tasks" "$prd_title" "$prd_summary" "$mode" 2>/dev/null || echo "{}")

  # 提取 run_id
  local run_id
  run_id=$(echo "$response" | jq -r '.run_id // empty' 2>/dev/null || echo "")

  if [[ -n "$run_id" ]]; then
    save_run_id "$run_id"
    log_info "Run created: $run_id"

    # 同步到 Notion（后台执行，静默失败）
    "$CECELIA_API" sync-to-notion "$run_id" &>/dev/null &

    echo "$run_id"
  else
    log_warn "Failed to create run (Core API may be unavailable)"
    echo ""
  fi
}

# 更新步骤
cmd_step() {
  local step_number="${1:-1}"
  local step_name="${2:-working}"

  local run_id
  run_id=$(get_run_id)

  if [[ -z "$run_id" ]]; then
    # 静默返回，不打印警告（避免在没有 run 时干扰输出）
    return 0
  fi

  if ! check_api; then
    return 0
  fi

  log_info "Step $step_number: $step_name"

  # 更新状态（静默失败）
  "$CECELIA_API" update-run "$run_id" "running" "$step_name" "$step_number" &>/dev/null || true

  # 同步到 Notion（后台执行）
  "$CECELIA_API" sync-to-notion "$run_id" &>/dev/null &
}

# 任务完成
cmd_done() {
  local pr_url="${1:-}"

  local run_id
  run_id=$(get_run_id)

  if [[ -z "$run_id" ]]; then
    return 0
  fi

  if ! check_api; then
    return 0
  fi

  log_info "Run completed: $run_id"

  # 更新状态（使用 update-run，传递 PR URL 作为 action）
  if [[ -n "$pr_url" ]]; then
    "$CECELIA_API" update-run "$run_id" "completed" "Done: $pr_url" "" &>/dev/null || true
  else
    "$CECELIA_API" update-run "$run_id" "completed" "Done" "" &>/dev/null || true
  fi

  # 同步到 Notion
  "$CECELIA_API" sync-to-notion "$run_id" &>/dev/null || true

  # 清理
  clear_run_id
}

# 任务失败
cmd_fail() {
  local error_message="${1:-Unknown error}"

  local run_id
  run_id=$(get_run_id)

  if [[ -z "$run_id" ]]; then
    return 0
  fi

  if ! check_api; then
    return 0
  fi

  log_info "Run failed: $run_id - $error_message"

  # 更新状态
  "$CECELIA_API" update-run "$run_id" "failed" "$error_message" &>/dev/null || true

  # 同步到 Notion
  "$CECELIA_API" sync-to-notion "$run_id" &>/dev/null || true

  # 不清理 run_id，方便重试
}

# 获取状态
cmd_status() {
  local run_id
  run_id=$(get_run_id)

  if [[ -z "$run_id" ]]; then
    echo "No active run"
    return 0
  fi

  if ! check_api; then
    echo "Run ID: $run_id (API unavailable)"
    return 0
  fi

  echo "Current run: $run_id"
  "$CECELIA_API" get-run "$run_id" 2>/dev/null | jq -r '.run | "Status: \(.status)\nStep: \(.current_step // "N/A") - \(.current_action // "N/A")"' 2>/dev/null || echo "Unable to fetch status"
}

# 主入口
main() {
  local cmd="${1:-status}"
  shift || true

  case "$cmd" in
    start)
      cmd_start "$@"
      ;;
    step)
      cmd_step "$@"
      ;;
    done)
      cmd_done "$@"
      ;;
    fail)
      cmd_fail "$@"
      ;;
    status)
      cmd_status "$@"
      ;;
    *)
      echo "Usage: track.sh {start|step|done|fail|status} [args...]"
      exit 1
      ;;
  esac
}

main "$@"
