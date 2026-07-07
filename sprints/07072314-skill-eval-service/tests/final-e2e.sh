#!/usr/bin/env bash
# Final E2E — Skill Evaluator 内部验收台 thin 贯穿
# target_environment: local_api（Brain API + 真实 HK 公网链路）
# 前置：~/incoming/日报skill-v1.2-7.7.zip 存在，Basic Auth 凭据来自 1Password CS
#
# 用法：bash /workspace/sprints/07072314-skill-eval-service/tests/final-e2e.sh
set -euo pipefail

DOCS_URL="https://docs.zenjoymedia.media"
ZIP_PATH="$HOME/incoming/日报skill-v1.2-7.7.zip"
BRAIN_URL="http://localhost:5221"

# 读取凭据
echo "[init] 读取凭据..."
if command -v op &>/dev/null && [ -f "$HOME/.credentials/1password.env" ]; then
  source "$HOME/.credentials/1password.env"
  export OP_SERVICE_ACCOUNT_TOKEN
  BASIC_AUTH=$(op item get "ZenithJoy Docs Basic Auth" --vault CS --field password 2>/dev/null || echo "")
fi
if [ -z "${BASIC_AUTH:-}" ] && [ -f "$HOME/.credentials/zenjoymedia-docs.env" ]; then
  source "$HOME/.credentials/zenjoymedia-docs.env"
  BASIC_AUTH="${DOCS_BASIC_AUTH:-}"
fi
[ -n "${BASIC_AUTH:-}" ] || (echo "FAIL: BASIC_AUTH not set, check 1Password CS or ~/.credentials/" && exit 1)

# 前置检查
echo "[init] 检查前置条件..."
[ -f "$ZIP_PATH" ] || (echo "FAIL: zip not found at $ZIP_PATH" && exit 1)
echo "  zip: $ZIP_PATH"
echo "  docs: $DOCS_URL"
echo "  brain: $BRAIN_URL"

# ─────────────────────────────────────────────────────────────────
# Step 1: 不带令牌直打 Brain 上传端点必须 403
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[1/6] 验证 Brain 令牌保护（no-token → 403）..."
HTTP_CODE=$(curl -s -o /tmp/e2e_resp1.json -w "%{http_code}" \
  -F "file=@$ZIP_PATH" \
  "$BRAIN_URL/api/brain/skill-eval/upload")
[ "$HTTP_CODE" = "403" ] || (echo "FAIL: Brain upload not token-protected, got $HTTP_CODE" && cat /tmp/e2e_resp1.json && exit 1)
echo "  PASS: 403 without X-Eval-Proxy-Token"

# ─────────────────────────────────────────────────────────────────
# Step 2: 通过公网 Basic Auth 上传 zip
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[2/6] 上传 zip（公网 Basic Auth）..."
RESPONSE=$(curl -sf -u "$BASIC_AUTH" \
  -F "file=@$ZIP_PATH" \
  -F "skill_name=日报Skill-v1.2" \
  -F "source_platform=Claude" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  "$DOCS_URL/eval-api/upload")
TASK_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])")
INIT_STATUS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','unknown'))")
echo "  task_id: $TASK_ID"
echo "  initial status: $INIT_STATUS"

# ─────────────────────────────────────────────────────────────────
# Step 3: 轮询至 completed（5s → ×1.5 退避 → 封顶 30s，最长 30min）
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[3/6] 轮询状态（最长 30min）..."
STATUS="$INIT_STATUS"
REPORT_URL=""
SLEEP=5
MAX_TICKS=360

for i in $(seq 1 $MAX_TICKS); do
  STATUS_JSON=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/eval-api/status/$TASK_ID")
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
  QUEUE_POS=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('queue_position','N/A'))")

  printf "  tick %3d | status=%-20s | queue_pos=%s\n" "$i" "$STATUS" "$QUEUE_POS"

  if [ "$STATUS" = "completed" ]; then
    REPORT_URL=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('report_url',''))")
    break
  fi

  if echo "$STATUS" | grep -qE "^failed"; then
    echo "FAIL: evaluation failed with status=$STATUS"
    echo "  response: $STATUS_JSON"
    exit 1
  fi

  # 指数退避（5s → ×1.5 → 封顶 30s）
  sleep "$SLEEP"
  SLEEP=$(python3 -c "print(min(30, round($SLEEP * 1.5, 1)))")
done

[ "$STATUS" = "completed" ] || (echo "FAIL: timeout after 30min, final status=$STATUS" && exit 1)
echo "  PASS: completed"
echo "  report_url: $REPORT_URL"
[ -n "$REPORT_URL" ] || (echo "FAIL: report_url is empty" && exit 1)

# ─────────────────────────────────────────────────────────────────
# Step 4: 报告内容断言（带 Basic Auth）
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[4/6] 断言报告内容（带 Basic Auth）..."
REPORT_BODY=$(curl -sf -u "$BASIC_AUTH" "$REPORT_URL")
echo "$REPORT_BODY" | grep -q "功能地图" || (echo "FAIL: '功能地图' missing in report" && exit 1)
echo "$REPORT_BODY" | grep -q "裁决" || (echo "FAIL: '裁决' missing in report" && exit 1)
echo "  PASS: 功能地图 and 裁决 found in report"

# ─────────────────────────────────────────────────────────────────
# Step 5: 不带 Basic Auth 访问 report_url 必须 401
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[5/6] 验证报告保护（no-auth → 401）..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL")
[ "$HTTP_CODE" = "401" ] || (echo "FAIL: report not protected, got $HTTP_CODE (expected 401)" && exit 1)
echo "  PASS: 401 without Basic Auth"

# ─────────────────────────────────────────────────────────────────
# Step 6: 评估索引页含本次 task_id 条目
# ─────────────────────────────────────────────────────────────────
echo ""
echo "[6/6] 验证索引页含本次评估条目..."
INDEX_BODY=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/skill-evals/")
echo "$INDEX_BODY" | grep -q "$TASK_ID" || (echo "FAIL: task_id=$TASK_ID missing from index page" && exit 1)
echo "  PASS: task_id found in index.html"

# ─────────────────────────────────────────────────────────────────
# 汇总
# ─────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "=== ALL ASSERTIONS PASSED ==="
echo "============================================"
echo "task_id:    $TASK_ID"
echo "report_url: $REPORT_URL"
echo ""
