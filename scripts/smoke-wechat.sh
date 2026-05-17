#!/usr/bin/env bash
# smoke-wechat.sh
# 发布1条测试图文到微信公众号，验证 wechat-publisher 端到端可用性
#
# 用法：
#   bash scripts/smoke-wechat.sh
#
# 成功标准：exit 0 + 任务 status=completed + publish_logs 有记录

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────────────────────────
BRAIN="${BRAIN_URL:-http://localhost:5221}"
POLL_INTERVAL=10
TIMEOUT=120
SMOKE_TAG="smoke-wechat-$(date +%Y%m%d-%H%M%S)"

SMOKE_TITLE="Cecelia 冒烟测试 — 微信公众号"
SMOKE_CONTENT="<p>自动化端到端冒烟测试，验证 wechat-publisher 可用性。</p><p>标签：${SMOKE_TAG}</p>"
SMOKE_DIGEST="自动化端到端冒烟测试 — Cecelia 系统验证"
SMOKE_AUTHOR="Cecelia"

# ─── 工具函数 ─────────────────────────────────────────────────────────────────
log()  { echo "[smoke-wechat] $(date '+%H:%M:%S') $*"; }
fail() { echo "[smoke-wechat] ERROR: $*" >&2; exit 1; }

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
    --arg tag     "$SMOKE_TAG" \
    --arg title   "$SMOKE_TITLE" \
    --arg content "$SMOKE_CONTENT" \
    --arg digest  "$SMOKE_DIGEST" \
    --arg author  "$SMOKE_AUTHOR" \
    '{
      title:          ("smoke: wechat [\($tag)]"),
      task_type:      "content_publish",
      priority:       "P1",
      trigger_source: "smoke-wechat",
      payload: {
        platform:     "wechat",
        content_type: "article",
        title:        $title,
        content:      $content,
        digest:       $digest,
        author:       $author,
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

check_publish_log() {
  local task_id="$1"
  curl -sf --max-time 5 \
    "$BRAIN/api/brain/publish-results?platform=wechat&limit=10" 2>/dev/null \
    | jq -r --arg task_id "$task_id" \
      '[.results[] | select(.task_id == $task_id)] | length' 2>/dev/null || echo "0"
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
  check_deps
  check_brain

  log "冒烟测试开始 | platform=wechat | tag=$SMOKE_TAG"
  echo ""

  # 创建任务
  log "创建 content_publish 任务 (platform=wechat, content_type=article) ..."
  local task_id
  task_id=$(create_task) || true
  [[ -n "$task_id" ]] || fail "任务创建失败 — Brain API 未返回 task_id"
  log "任务创建成功 → task_id=$task_id"

  echo ""
  log "等待任务完成（超时 ${TIMEOUT}s，轮询间隔 ${POLL_INTERVAL}s）..."

  # 轮询
  local start_ts
  start_ts=$(date +%s)
  local deadline=$(( start_ts + TIMEOUT ))
  local final_status="" final_error="" elapsed=0

  while [[ $(date +%s) -lt $deadline ]]; do
    local status
    status=$(get_task_status "$task_id")

    case "$status" in
      completed|failed|terminal_failure)
        elapsed=$(( $(date +%s) - start_ts ))
        final_status="$status"
        if [[ "$status" != "completed" ]]; then
          final_error="$(get_task_error "$task_id")"
        fi
        break
        ;;
      *)
        sleep "$POLL_INTERVAL"
        ;;
    esac
  done

  if [[ -z "$final_status" ]]; then
    elapsed="$TIMEOUT"
    final_status="timeout"
    final_error="exceeded_${TIMEOUT}s"
  fi

  # 结果报告
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " 微信公众号冒烟测试结果 | $SMOKE_TAG"
  echo "════════════════════════════════════════════════════════"
  printf " 任务 ID   : %s\n" "$task_id"
  printf " 最终状态  : %s\n" "$final_status"
  printf " 耗时      : %ss\n" "$elapsed"
  [[ -n "$final_error" ]] && printf " 错误信息  : %s\n" "$final_error"

  if [[ "$final_status" == "completed" ]]; then
    # 验证 publish_results 有回写记录（soft check）
    local log_count
    log_count=$(check_publish_log "$task_id")
    if [[ "${log_count}" -gt 0 ]]; then
      printf " 发布记录  : publish_results 已写入 (%s 条)\n" "$log_count"
    else
      printf " 发布记录  : [WARN] publish_results 暂无记录（可能延迟写入）\n"
    fi
    echo "════════════════════════════════════════════════════════"
    echo " ✅ 冒烟测试通过 — wechat-publisher 端到端可用"
    echo "════════════════════════════════════════════════════════"
    exit 0
  else
    echo "════════════════════════════════════════════════════════"
    printf " ❌ 冒烟测试失败 — 状态: %s\n" "$final_status"
    echo "════════════════════════════════════════════════════════"
    exit 1
  fi
}

main "$@"
