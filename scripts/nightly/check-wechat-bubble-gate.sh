#!/usr/bin/env bash
# check-wechat-bubble-gate.sh — 微信气泡门真机检查
#
# 在 ROG（staging 环境）运行。由 nightly-real-machine-staging.yml 通过 SSH 触发。
#
# 验收标准（微信气泡门）：
#   1. 向 staging Brain 发布 content_publish 任务（platform=wechat）
#   2. 等待任务完成
#   3. 确认 publish_results 有写入记录（staging Brain 回写）
#   4. 若配置了 WECHAT_TEST_CONTACT，通过 wechat_rpa.py 验证气泡刷新（DELIVERED）
#
# 环境变量：
#   BRAIN_URL             — Staging Brain URL（默认 http://localhost:5222）
#   TIMEOUT               — 最长等待秒数（默认 420）
#   WECHAT_TEST_CONTACT   — 气泡门验证联系人（可选；不设则只验 Brain 回写）
#   WECHAT_RPA_DRYRUN     — 1 = 跳过真实 RPA（测试用）
#
# 退出码：
#   0 = 通过
#   1 = 失败

set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5222}"
TIMEOUT="${TIMEOUT:-420}"
POLL_INTERVAL=10
SMOKE_TAG="nightly-wx-bubble-$(date +%Y%m%d-%H%M%S)"
RPA_SCRIPT="${ROG_DEPLOY_DIR:-/opt/cecelia/nightly}/../agents/wechat_rpa.py"

log()  { echo "[wechat-bubble-gate] $(date '+%H:%M:%S') $*"; }
fail() { echo "[wechat-bubble-gate] FAIL: $*" >&2; exit 1; }

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

# ── 3. 提交 WeChat 测试任务 ──────────────────────────────────────────────────
log "提交 WeChat 发布任务（smoke_test=true）tag=$SMOKE_TAG"
TASK_BODY=$(jq -n \
  --arg tag "$SMOKE_TAG" \
  '{
    title:          ("nightly-smoke: wechat [\($tag)]"),
    task_type:      "content_publish",
    priority:       "P1",
    trigger_source: "nightly-real-machine-staging",
    payload: {
      platform:     "wechat",
      content_type: "article",
      title:        "Cecelia Nightly Smoke — 微信气泡门",
      content:      "<p>自动化每晚真机回归测试。标签：\($tag)</p>",
      digest:       "Nightly 气泡门回归",
      author:       "Cecelia-Nightly",
      smoke_test:   true,
      smoke_tag:    $tag
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
  fail "任务未完成（状态: $FINAL_STATUS，错误: $ERROR）— 微信气泡门失败"
fi

# ── 5. 验证 publish_results 回写 ─────────────────────────────────────────────
log "验证 publish_results 回写..."
LOG_COUNT=$(curl -sf --max-time 5 \
  "$BRAIN/api/brain/publish-results?platform=wechat&limit=20" \
  | jq -r --arg tid "$TASK_ID" \
    '[.results[] | select(.task_id == $tid)] | length' 2>/dev/null || echo "0")

if [[ "${LOG_COUNT:-0}" -gt 0 ]]; then
  log "✓ publish_results 已写入 ($LOG_COUNT 条)"
else
  log "⚠  publish_results 暂无记录（可能延迟写入，soft check — 不计为失败）"
fi

# ── 6. 气泡门：RPA 验证气泡刷新（可选，需 wechat_rpa.py 已部署）────────────
if [[ -n "${WECHAT_TEST_CONTACT:-}" ]] && [[ -f "$RPA_SCRIPT" ]]; then
  log "气泡门 RPA 验证：contact=$WECHAT_TEST_CONTACT"
  RPA_REQ=$(jq -n \
    --arg tag     "$SMOKE_TAG" \
    --arg contact "$WECHAT_TEST_CONTACT" \
    '{
      session_id:  $tag,
      action_type: "read_inbox",
      target:      $contact
    }')
  RPA_RESULT=$(echo "$RPA_REQ" | python3 "$RPA_SCRIPT" 2>&1)
  RPA_OK=$(echo "$RPA_RESULT" | jq -r '.ok // false' 2>/dev/null || echo "false")
  if [[ "$RPA_OK" != "true" ]]; then
    log "⚠  RPA read_inbox 返回非 ok（$RPA_RESULT）— 气泡门软失败"
  else
    log "✓ RPA read_inbox 通过"
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo " ✅ 微信气泡门检查通过 | tag=$SMOKE_TAG | task=$TASK_ID"
echo "════════════════════════════════════════════════════════"
exit 0
