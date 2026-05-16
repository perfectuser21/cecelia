#!/usr/bin/env bash
# smoke-publish-pipeline.sh
# 创建1条 content_publish 任务，验证管道修复后任务可运行至 completed/failed（非 canceled）
#
# 用法：
#   bash scripts/smoke-publish-pipeline.sh
#
# 成功标准：exit 0 + 任务 status=completed 或 status=failed
# 失败标准：exit 1 + 任务 status=canceled（表明管道仍在错误取消任务）

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────────
BRAIN="${BRAIN_URL:-http://localhost:5221}"
INITIAL_WAIT=30     # 初始等待（秒）— 给管道足够时间处理
POLL_INTERVAL=10    # 轮询间隔（秒）
TIMEOUT=120         # 最长等待（秒）
SMOKE_TAG="smoke-pipeline-$(date +%Y%m%d-%H%M%S)"

# ─── 工具函数 ─────────────────────────────────────────────────────────────────
log()  { echo "[smoke-pipeline] $(date '+%H:%M:%S') $*"; }
fail() { echo "[smoke-pipeline] ERROR: $*" >&2; exit 1; }

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

create_task() {
  local body
  body=$(jq -n \
    --arg tag "$SMOKE_TAG" \
    '{
      title:          ("smoke: publish-pipeline [\($tag)]"),
      task_type:      "content_publish",
      priority:       "P1",
      trigger_source: "smoke-publish-pipeline",
      payload: {
        platform:     "douyin",
        content_type: "idea",
        title:        "Cecelia 管道冒烟测试",
        content:      "自动化端到端管道验证 — 确认任务不被错误取消",
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

  log "冒烟测试开始 | tag=$SMOKE_TAG"
  echo ""

  # 创建任务
  log "创建 content_publish 任务 (platform=douyin, content_type=idea) ..."
  local task_id
  task_id=$(create_task) || true
  [[ -n "$task_id" ]] || fail "任务创建失败 — Brain API 未返回 task_id"
  log "任务创建成功 → task_id=$task_id"

  echo ""
  log "等待 ${INITIAL_WAIT}s（让管道有时间拾取并处理任务）..."
  sleep "$INITIAL_WAIT"

  # 首次查询
  local start_ts
  start_ts=$(date +%s)
  local deadline=$(( start_ts + TIMEOUT - INITIAL_WAIT ))
  local final_status="" final_error="" elapsed=0

  while true; do
    local status
    status=$(get_task_status "$task_id")
    elapsed=$(( $(date +%s) - start_ts + INITIAL_WAIT ))

    case "$status" in
      completed|failed)
        final_status="$status"
        if [[ "$status" != "completed" ]]; then
          final_error="$(get_task_error "$task_id")"
        fi
        break
        ;;
      canceled)
        final_status="canceled"
        final_error="$(get_task_error "$task_id")"
        break
        ;;
      terminal_failure)
        final_status="terminal_failure"
        final_error="$(get_task_error "$task_id")"
        break
        ;;
    esac

    if [[ $(date +%s) -ge $deadline ]]; then
      final_status="timeout"
      final_error="exceeded_${TIMEOUT}s (last_status=${status})"
      break
    fi

    log "状态: $status — 继续轮询（已等待 ${elapsed}s）..."
    sleep "$POLL_INTERVAL"
  done

  # ── 结果报告 ──────────────────────────────────────────────────────────────
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " 发布管道冒烟测试结果 | $SMOKE_TAG"
  echo "════════════════════════════════════════════════════════"
  printf " 任务 ID   : %s\n" "$task_id"
  printf " 最终状态  : %s\n" "$final_status"
  printf " 耗时      : %ss\n" "$elapsed"
  [[ -n "${final_error:-}" ]] && printf " 错误信息  : %s\n" "$final_error"

  case "$final_status" in
    completed|failed)
      echo "════════════════════════════════════════════════════════"
      printf " ✅ 冒烟测试通过 — 管道正常运行（status=%s，非 canceled）\n" "$final_status"
      echo "════════════════════════════════════════════════════════"
      exit 0
      ;;
    canceled)
      echo "════════════════════════════════════════════════════════"
      echo " ❌ 冒烟测试失败 — 任务被取消（管道 Bug 仍存在）"
      echo "════════════════════════════════════════════════════════"
      exit 1
      ;;
    *)
      echo "════════════════════════════════════════════════════════"
      printf " ❌ 冒烟测试失败 — 未达到终态（status=%s）\n" "$final_status"
      echo "════════════════════════════════════════════════════════"
      exit 1
      ;;
  esac
}

main "$@"
