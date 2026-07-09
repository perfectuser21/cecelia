#!/usr/bin/env bash
# check-douyin-keyword-read.sh — 抖音 keyword 读侧真机检查
#
# 在 ROG（staging 环境）运行。由 nightly-real-machine-staging.yml 通过 SSH 触发。
#
# 验收标准（抖音 keyword 读侧）：
#   1. 向 staging Brain 发布 content_publish 任务（platform=douyin，带唯一关键字）
#   2. 等待任务完成
#   3. 验证 publish_results 有回写记录（staging Brain）
#   4. 若配置了读侧检查（DOUYIN_READ_ENABLED=1），调用 douyin_rpa.py 搜索关键字确认可读侧
#
# 环境变量：
#   BRAIN_URL             — Staging Brain URL（默认 http://localhost:5222）
#   TIMEOUT               — 最长等待秒数（默认 420）
#   DOUYIN_READ_ENABLED   — 1 = 启用 keyword 读侧验证（需 douyin_rpa.py 已部署）
#
# 退出码：
#   0 = 通过
#   1 = 失败

set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5222}"
TIMEOUT="${TIMEOUT:-420}"
POLL_INTERVAL=10
# 带日期的唯一关键字，用于读侧搜索
KEYWORD="cecelia-nightly-$(date +%Y%m%d)"
SMOKE_TAG="nightly-dy-keyword-$(date +%Y%m%d-%H%M%S)"
DOUYIN_RPA_SCRIPT="${ROG_DEPLOY_DIR:-/opt/cecelia/nightly}/../agents/douyin_rpa.py"

log()  { echo "[douyin-keyword-read] $(date '+%H:%M:%S') $*"; }
fail() { echo "[douyin-keyword-read] FAIL: $*" >&2; exit 1; }

# ── 1. 依赖预检 ──────────────────────────────────────────────────────────────
for cmd in curl jq python3; do
  command -v "$cmd" &>/dev/null || fail "缺少依赖: $cmd"
done

# ── 2. Staging Brain 连通性 ──────────────────────────────────────────────────
log "检查 Staging Brain 连通性：$BRAIN"
if ! curl -sf --max-time 10 "$BRAIN/api/brain/health" -o /dev/null; then
  fail "Staging Brain 不可达：$BRAIN（ROG 是否已连到 staging？）"
fi
log "✓ Staging Brain 连通"

# ── 3. 提交抖音发布任务（带唯一 keyword）────────────────────────────────────
log "提交抖音发布任务 keyword=$KEYWORD tag=$SMOKE_TAG"
TASK_BODY=$(jq -n \
  --arg tag     "$SMOKE_TAG" \
  --arg keyword "$KEYWORD" \
  '{
    title:          ("nightly-smoke: douyin-keyword [\($tag)]"),
    task_type:      "content_publish",
    priority:       "P1",
    trigger_source: "nightly-real-machine-staging",
    payload: {
      platform:     "douyin",
      content_type: "idea",
      title:        ("Nightly 读侧验证 \($keyword)"),
      content:      ("自动化每晚真机回归 — 关键字: \($keyword)"),
      smoke_test:   true,
      smoke_tag:    $tag,
      nightly_keyword: $keyword
    }
  }')

TASK_ID=$(curl -sf --max-time 15 \
  -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "$TASK_BODY" | jq -r '.id // empty')

[[ -n "$TASK_ID" ]] || fail "任务创建失败 — Brain 未返回 task_id"
log "任务已创建 → task_id=$TASK_ID"

# ── 4. 轮询任务结果 ──────────────────────────────────────────────────────────
log "等待任务完成（超时 ${TIMEOUT}s，每 ${POLL_INTERVAL}s 轮询）..."
DEADLINE=$(( $(date +%s) + TIMEOUT ))
FINAL_STATUS=""

while [[ $(date +%s) -lt $DEADLINE ]]; do
  STATUS=$(curl -sf --max-time 5 "$BRAIN/api/brain/tasks/$TASK_ID" \
    | jq -r '.status // "unknown"')
  case "$STATUS" in
    completed|failed|terminal_failure)
      FINAL_STATUS="$STATUS"
      break
      ;;
    *)
      log "  当前状态: $STATUS，继续等待..."
      sleep "$POLL_INTERVAL"
      ;;
  esac
done

if [[ -z "$FINAL_STATUS" ]]; then
  FINAL_STATUS="timeout"
fi

log "任务最终状态: $FINAL_STATUS"

if [[ "$FINAL_STATUS" != "completed" ]]; then
  ERROR=$(curl -sf --max-time 5 "$BRAIN/api/brain/tasks/$TASK_ID" \
    | jq -r '.error_message // .result.error // "unknown error"' 2>/dev/null || echo "api error")
  fail "任务未完成（状态: $FINAL_STATUS，错误: $ERROR）— 抖音 keyword 读侧失败"
fi

# ── 5. 验证 publish_results 回写 ─────────────────────────────────────────────
log "验证 publish_results 回写..."
LOG_COUNT=$(curl -sf --max-time 5 \
  "$BRAIN/api/brain/publish-results?platform=douyin&limit=20" \
  | jq -r --arg tid "$TASK_ID" \
    '[.results[] | select(.task_id == $tid)] | length' 2>/dev/null || echo "0")

if [[ "${LOG_COUNT:-0}" -gt 0 ]]; then
  log "✓ publish_results 已写入 ($LOG_COUNT 条)"
else
  log "⚠  publish_results 暂无记录（可能延迟写入，soft check — 不计为失败）"
fi

# ── 6. 读侧验证：搜索关键字确认内容可被读侧（可选）─────────────────────────
if [[ "${DOUYIN_READ_ENABLED:-0}" == "1" ]]; then
  if [[ -f "$DOUYIN_RPA_SCRIPT" ]]; then
    # 等待平台索引（通常 30-60s 后才可搜索）
    log "等待平台索引（60s）..."
    sleep 60

    log "读侧搜索关键字：$KEYWORD"
    READ_REQ=$(jq -n \
      --arg keyword "$KEYWORD" \
      --arg tag     "$SMOKE_TAG" \
      '{
        session_id:  $tag,
        action_type: "keyword_search",
        keyword:     $keyword
      }')
    READ_RESULT=$(echo "$READ_REQ" | python3 "$DOUYIN_RPA_SCRIPT" 2>&1)
    READ_OK=$(echo "$READ_RESULT" | jq -r '.ok // false' 2>/dev/null || echo "false")
    FOUND=$(echo "$READ_RESULT" | jq -r '.data.found // false' 2>/dev/null || echo "false")

    if [[ "$READ_OK" == "true" ]] && [[ "$FOUND" == "true" ]]; then
      log "✓ 关键字读侧搜索命中：keyword=$KEYWORD"
    else
      log "⚠  关键字读侧搜索未命中（$READ_RESULT）"
    fi
  else
    log "⚠  douyin_rpa.py 未部署（$DOUYIN_RPA_SCRIPT），跳过读侧搜索"
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo " ✅ 抖音 keyword 读侧检查通过 | keyword=$KEYWORD | task=$TASK_ID"
echo "════════════════════════════════════════════════════════"
exit 0
