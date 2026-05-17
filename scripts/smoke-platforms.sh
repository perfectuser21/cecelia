#!/usr/bin/env bash
# smoke-platforms.sh
# 对4个公域平台各发布1条测试内容，验证 publisher skill 端到端可用性
#
# 用法：
#   bash scripts/smoke-platforms.sh                   # 全部4个平台
#   bash scripts/smoke-platforms.sh --platform douyin  # 单平台测试
#
# 输出：平台 | 状态 | 耗时 | 错误码
# 成功标准：≥3/4 平台 status=completed

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────────
BRAIN="${BRAIN_URL:-http://localhost:5221}"
POLL_INTERVAL=10    # 轮询间隔（秒）
TIMEOUT=300         # 最长等待（秒）
SMOKE_TAG="smoke-$(date +%Y%m%d-%H%M%S)"

# 4个公域平台及其最轻量内容类型
declare -A PLATFORM_CONTENT_TYPE
PLATFORM_CONTENT_TYPE=(
  [douyin]="idea"
  [kuaishou]="idea"
  [weibo]="image"
  [toutiao]="weitoutiao"
)

SMOKE_TITLE="Cecelia 冒烟测试"
SMOKE_CONTENT="自动化端到端冒烟测试 — Cecelia 系统验证 $SMOKE_TAG"

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
FILTER_PLATFORM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      FILTER_PLATFORM="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:-300}"
      shift 2
      ;;
    -h|--help)
      echo "用法: bash scripts/smoke-platforms.sh [--platform <平台>] [--timeout <秒>]"
      echo "平台: douyin kuaishou weibo toutiao"
      exit 0
      ;;
    *)
      echo "[smoke] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

# ─── 工具函数 ─────────────────────────────────────────────────────────────────
log()  { echo "[smoke] $(date '+%H:%M:%S') $*"; }
fail() { echo "[smoke] ERROR: $*" >&2; exit 1; }

check_deps() {
  for cmd in curl jq; do
    command -v "$cmd" &>/dev/null || fail "缺少依赖: $cmd"
  done
}

check_brain() {
  curl -sf --max-time 5 "$BRAIN/api/brain/tasks?limit=1" -o /dev/null 2>/dev/null \
    || fail "Brain API 不可达: $BRAIN — 请先启动 Brain 服务"
  log "Brain API 连通 ✓"
}

# 创建 content_publish 任务，输出 task_id
create_task() {
  local platform="$1"
  local content_type="${PLATFORM_CONTENT_TYPE[$platform]}"

  local body
  body=$(jq -n \
    --arg platform "$platform" \
    --arg ct       "$content_type" \
    --arg title    "${SMOKE_TITLE} (${platform})" \
    --arg content  "$SMOKE_CONTENT" \
    --arg tag      "$SMOKE_TAG" \
    '{
      title:          ("smoke: \($platform) [\($tag)]"),
      task_type:      "content_publish",
      priority:       "P1",
      trigger_source: "smoke-platforms",
      payload: {
        platform:     $platform,
        content_type: $ct,
        title:        $title,
        content:      $content,
        smoke_test:   true,
        smoke_tag:    $tag
      }
    }')

  curl -sf --max-time 10 \
    -X POST "$BRAIN/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null \
    | jq -r '.id // empty'
}

get_task_status() {
  curl -sf --max-time 5 "$BRAIN/api/brain/tasks/$1" 2>/dev/null \
    | jq -r '.status // "unknown"'
}

get_task_error() {
  curl -sf --max-time 5 "$BRAIN/api/brain/tasks/$1" 2>/dev/null \
    | jq -r '.error_message // .result.error // empty'
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
  check_deps
  check_brain

  local platforms=()
  if [[ -n "$FILTER_PLATFORM" ]]; then
    [[ -v "PLATFORM_CONTENT_TYPE[$FILTER_PLATFORM]" ]] \
      || fail "不支持的平台: $FILTER_PLATFORM（可选: ${!PLATFORM_CONTENT_TYPE[*]}）"
    platforms=("$FILTER_PLATFORM")
  else
    platforms=(douyin kuaishou weibo toutiao)
  fi

  log "冒烟测试开始 | 平台: ${platforms[*]} | tag: $SMOKE_TAG"
  echo ""

  # ── 阶段1: 创建所有任务 ────────────────────────────────────────────────────
  declare -A TASK_IDS
  declare -A START_TIMES

  for platform in "${platforms[@]}"; do
    log "创建任务: $platform ..."
    local task_id
    task_id=$(create_task "$platform") || true
    if [[ -z "$task_id" ]]; then
      log "  ⚠ $platform 任务创建失败"
      TASK_IDS[$platform]=""
    else
      log "  ✓ $platform → task_id=$task_id"
      TASK_IDS[$platform]="$task_id"
      START_TIMES[$platform]="$(date +%s)"
    fi
  done

  echo ""
  log "等待任务完成（超时 ${TIMEOUT}s，轮询间隔 ${POLL_INTERVAL}s）..."
  echo ""

  # ── 阶段2: 轮询直到所有任务完成或超时 ─────────────────────────────────────
  declare -A FINAL_STATUS
  declare -A FINAL_ERROR
  declare -A ELAPSED

  local deadline=$(( $(date +%s) + TIMEOUT ))

  while [[ $(date +%s) -lt $deadline ]]; do
    local pending=0

    for platform in "${platforms[@]}"; do
      [[ -n "${FINAL_STATUS[$platform]:-}" ]] && continue

      local task_id="${TASK_IDS[$platform]:-}"
      if [[ -z "$task_id" ]]; then
        FINAL_STATUS[$platform]="create_failed"
        FINAL_ERROR[$platform]="task_creation_failed"
        ELAPSED[$platform]="0"
        continue
      fi

      local status
      status=$(get_task_status "$task_id")

      case "$status" in
        completed|failed|terminal_failure)
          FINAL_STATUS[$platform]="$status"
          ELAPSED[$platform]=$(( $(date +%s) - START_TIMES[$platform] ))
          if [[ "$status" != "completed" ]]; then
            FINAL_ERROR[$platform]="$(get_task_error "$task_id")"
          else
            FINAL_ERROR[$platform]=""
          fi
          log "[$platform] $status (${ELAPSED[$platform]}s)"
          ;;
        *)
          (( pending++ )) || true
          ;;
      esac
    done

    [[ $pending -eq 0 ]] && break
    sleep "$POLL_INTERVAL"
  done

  # 超时的任务
  for platform in "${platforms[@]}"; do
    if [[ -z "${FINAL_STATUS[$platform]:-}" ]]; then
      FINAL_STATUS[$platform]="timeout"
      FINAL_ERROR[$platform]="exceeded_${TIMEOUT}s"
      ELAPSED[$platform]="$TIMEOUT"
    fi
  done

  # ── 阶段3: 结果报告 ────────────────────────────────────────────────────────
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " 冒烟测试结果 | $SMOKE_TAG"
  echo "════════════════════════════════════════════════════════"
  printf "%-12s | %-18s | %-8s | %s\n" "平台" "状态" "耗时" "错误码"
  echo "────────────────────────────────────────────────────────"

  local success_count=0
  local total_count=${#platforms[@]}

  for platform in "${platforms[@]}"; do
    local status="${FINAL_STATUS[$platform]:-unknown}"
    local elapsed="${ELAPSED[$platform]:-?}"
    local error="${FINAL_ERROR[$platform]:-}"

    local icon="❌"
    [[ "$status" == "completed" ]] && { icon="✅"; (( success_count++ )) || true; }
    [[ "$status" == "timeout"   ]] && icon="⏱"

    printf "%-12s | %-2s %-15s | %-6ss | %s\n" \
      "$platform" "$icon" "$status" "$elapsed" "${error:-—}"
  done

  echo "════════════════════════════════════════════════════════"
  printf " 结果: %d/%d 平台成功\n" "$success_count" "$total_count"

  local min_pass=3
  [[ $total_count -le 1 ]] && min_pass=1

  if [[ $success_count -ge $min_pass ]]; then
    printf " ✅ 冒烟测试通过（%d/%d ≥ %d/%d）\n" \
      "$success_count" "$total_count" "$min_pass" "$total_count"
    echo "════════════════════════════════════════════════════════"
    exit 0
  else
    printf " ❌ 冒烟测试失败（%d/%d < %d/%d）\n" \
      "$success_count" "$total_count" "$min_pass" "$total_count"
    echo "════════════════════════════════════════════════════════"
    exit 1
  fi
}

main "$@"
