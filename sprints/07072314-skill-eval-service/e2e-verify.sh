#!/usr/bin/env bash
# e2e-verify.sh — Skill Evaluator thin 贯穿 E2E 验收脚本
# Sprint: 07072314-skill-eval-service
#
# 覆盖 6 个验收点（contract-dod.md [BEHAVIOR-1~10] 核心点）：
#   1. 真实上传 fixture zip → 返回 task_id
#   2. 轮询 status/:task_id 至 completed（≤30min）
#   3. 带 Basic Auth 访问 report_url → 200 + 含"功能地图"与"裁决"
#   4. report_url 不带 Basic Auth → 401
#   5. 无 X-Eval-Proxy-Token 直打 Brain → 403
#   6. 评估索引页含本次条目（task_id 或 skill 名称）
#
# 环境变量（从 ~/.credentials/skill-eval.env source）：
#   EVAL_HOST         — 评估台域名（default: docs.zenjoymedia.media）
#   EVAL_BASIC_AUTH   — Basic Auth user:pass
#   BRAIN_HOST        — Brain 直连地址（default: localhost:5221）
#   EVAL_PROXY_TOKEN  — X-Eval-Proxy-Token（用于验 403 测试）
#
# 退避计算使用 awk（不用 bc，bc 在 Windows 环境不可用）

set -euo pipefail

EVAL_HOST="${EVAL_HOST:-docs.zenjoymedia.media}"
EVAL_BASIC_AUTH="${EVAL_BASIC_AUTH:?需要设置 EVAL_BASIC_AUTH (user:pass)}"
BRAIN_HOST="${BRAIN_HOST:-localhost:5221}"
FIXTURE_ZIP="${HOME}/incoming/日报skill-v1.2-7.7.zip"

# 验证 fixture 存在
if [[ ! -f "${FIXTURE_ZIP}" ]]; then
  echo "ERROR: fixture zip not found: ${FIXTURE_ZIP}"
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ── 验收点 1: 上传 fixture zip → task_id ─────────────────────────────────────
echo ""
echo "=== BEHAVIOR-1: 真实上传 zip → task_id ==="

UPLOAD_RESP=$(curl -sf \
  -u "${EVAL_BASIC_AUTH}" \
  -F "file=@${FIXTURE_ZIP}" \
  -F "skill_name=日报skill" \
  -F "platform=Claude" \
  -F "journey_id=line00" \
  -F "submitter=e2e-verify" \
  "https://${EVAL_HOST}/eval-api/upload" 2>/dev/null)

echo "  响应: ${UPLOAD_RESP}"
TASK_ID=$(echo "${UPLOAD_RESP}" | jq -r '.task_id // empty' 2>/dev/null || true)

if [[ -n "${TASK_ID}" && "${TASK_ID}" != "null" ]]; then
  pass "task_id=${TASK_ID}"
else
  fail "未返回有效 task_id"
  echo "全部验收失败（上传阶段失败）"
  exit 1
fi

# 检查是否去重返回（已有 completed）
DEDUPED=$(echo "${UPLOAD_RESP}" | jq -r '.deduped // false' 2>/dev/null || echo "false")
REPORT_URL=$(echo "${UPLOAD_RESP}" | jq -r '.report_url // empty' 2>/dev/null || true)

if [[ "${DEDUPED}" == "true" && -n "${REPORT_URL}" ]]; then
  echo "  INFO: 去重命中，直接使用历史 report_url=${REPORT_URL}"
  # 跳到验收点 3
else
  QUEUE_POS=$(echo "${UPLOAD_RESP}" | jq -r '.queue_position // "?"' 2>/dev/null || echo "?")
  echo "  队列位置: ${QUEUE_POS}"

  # ── 验收点 2: 轮询至 completed（≤30min）─────────────────────────────────────
  echo ""
  echo "=== BEHAVIOR-2: 轮询至 completed（≤30min）==="

  DEADLINE=$((SECONDS + 1800))
  INTERVAL_MS=5000  # 5000ms = 5s（整数，awk 计算退避）
  REPORT_URL=""

  while [[ ${SECONDS} -lt ${DEADLINE} ]]; do
    STATUS_RESP=$(curl -sf \
      -u "${EVAL_BASIC_AUTH}" \
      "https://${EVAL_HOST}/eval-api/status/${TASK_ID}" 2>/dev/null || echo '{"status":"unknown"}')

    STATUS=$(echo "${STATUS_RESP}" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
    echo "  [$(date +%H:%M:%S)] status=${STATUS}"

    if [[ "${STATUS}" == "completed" ]]; then
      REPORT_URL=$(echo "${STATUS_RESP}" | jq -r '.report_url // empty' 2>/dev/null || true)
      pass "completed，report_url=${REPORT_URL}"
      break
    fi

    if [[ "${STATUS}" == failed* || "${STATUS}" == "failed" ]]; then
      REASON=$(echo "${STATUS_RESP}" | jq -r '.failure_reason // "unknown"' 2>/dev/null || echo "unknown")
      fail "任务失败: ${REASON}"
      exit 1
    fi

    # 退避计算（awk，不用 bc）
    SLEEP_SEC=$(echo "${INTERVAL_MS}" | awk '{s=int($1/1000); if(s<1)s=1; print s}')
    sleep "${SLEEP_SEC}"
    INTERVAL_MS=$(echo "${INTERVAL_MS}" | awk '{n=int($1*3/2); if(n>30000)n=30000; print n}')
  done

  if [[ -z "${REPORT_URL}" ]]; then
    fail "30min 内未 completed"
    exit 1
  fi
fi

# ── 验收点 3: 带 Basic Auth 访问 report_url → 200 + 含功能地图 + 裁决 ──────────
echo ""
echo "=== BEHAVIOR-6: 带 Basic Auth 访问报告 → 内容校验 ==="

REPORT_BODY=$(curl -sf -u "${EVAL_BASIC_AUTH}" "${REPORT_URL}" 2>/dev/null || true)

if echo "${REPORT_BODY}" | grep -q "功能地图"; then
  pass "报告含'功能地图'"
else
  fail "报告不含'功能地图'"
fi

if echo "${REPORT_BODY}" | grep -q "裁决"; then
  pass "报告含'裁决'"
else
  fail "报告不含'裁决'"
fi

# 四态 status 校验（用 jq 提取 status 字段）
EVAL_STATUS=$(echo "${REPORT_BODY}" | grep -oP '"status"\s*:\s*"\K[^"]+' | head -1 || true)
VALID_STATUSES="DONE DONE_WITH_CONCERNS NEEDS_CONTEXT BLOCKED"
if echo "${VALID_STATUSES}" | grep -qw "${EVAL_STATUS}"; then
  pass "报告 status 字段有效: ${EVAL_STATUS}"
else
  fail "报告 status 字段无效或缺失: '${EVAL_STATUS}'"
fi

# ── 验收点 4: report_url 不带 Basic Auth → 401 ─────────────────────────────────
echo ""
echo "=== BEHAVIOR-5: report_url 不带 Basic Auth → 401 ==="

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${REPORT_URL}" 2>/dev/null || echo "000")
if [[ "${HTTP_CODE}" == "401" ]]; then
  pass "不带 Basic Auth → 401"
else
  fail "期望 401，实际 ${HTTP_CODE}"
fi

# ── 验收点 5: 无 X-Eval-Proxy-Token 直打 Brain → 403 ───────────────────────────
echo ""
echo "=== BEHAVIOR-4: 无 token 直打 Brain → 403 ==="

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@${FIXTURE_ZIP}" \
  "http://${BRAIN_HOST}/api/skill-eval/upload" 2>/dev/null || echo "000")

if [[ "${HTTP_CODE}" == "403" ]]; then
  pass "无 token 直打 Brain → 403"
elif [[ "${HTTP_CODE}" == "000" ]]; then
  fail "Brain 不可达（BRAIN_HOST=${BRAIN_HOST}）"
else
  fail "期望 403，实际 ${HTTP_CODE}（检查 EVAL_PROXY_TOKEN 是否配置）"
fi

# ── 验收点 6: 评估索引页含本次条目 ─────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-10: 评估索引页含本次条目 ==="

INDEX_BODY=$(curl -sf -u "${EVAL_BASIC_AUTH}" \
  "https://${EVAL_HOST}/data/docs/skill-evals/index.html" 2>/dev/null || true)

if echo "${INDEX_BODY}" | grep -q "${TASK_ID}"; then
  pass "索引页含 task_id=${TASK_ID}"
elif echo "${INDEX_BODY}" | grep -q "日报skill"; then
  pass "索引页含 skill 名称"
else
  fail "索引页不含本次评估条目（task_id=${TASK_ID}）"
fi

# ── 汇总 ───────────────────────────────────────────────────────────────────────
echo ""
echo "================================"
echo "验收汇总: ${PASS_COUNT} 通过 / ${FAIL_COUNT} 失败"
echo "================================"

if [[ ${FAIL_COUNT} -gt 0 ]]; then
  echo "部分验收未通过，请检查上述失败项"
  exit 1
fi

echo "全部验收通过！"
