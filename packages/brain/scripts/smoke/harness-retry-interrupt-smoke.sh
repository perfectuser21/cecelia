#!/usr/bin/env bash
# harness-retry-interrupt-smoke.sh
#
# 真实环境 smoke：W2 + W5 在已部署 Brain 上是否生效。
#
# 验证清单（对应 PR cp-05062124-w2-w5-graph-retry-interrupt）：
#   1. Brain 已加载 retry-policies.js（/api/brain/manifest 或直接 require 模块）
#   2. /api/brain/harness-interrupts GET 路由可访问（200，返回 {interrupts:[]} 或现有列表）
#   3. /api/brain/harness-interrupts/:taskId/resume POST 缺 decision.action → 400
#   4. /api/brain/harness-interrupts/:taskId/resume POST 非法 action → 400
#   5. retry-policies LLM_RETRY/DB_RETRY/NO_RETRY 三个对象在容器内可 import
#
# 环境变量（自包含 / CI 复用）：
#   BRAIN_CONTAINER  默认 cecelia-node-brain
#   BRAIN_URL        默认 http://localhost:5221
#
# 退出码：0=PASS，非 0=FAIL。
# 跳过条件：缺 docker / brain 容器不健康 → exit 0 + 打印 SKIP。
set -euo pipefail

SMOKE_NAME="harness-retry-interrupt"
log() { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; exit 1; }
skip() { log "SKIP $*"; exit 0; }

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-node-brain}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# ── 1. 前置条件 ─────────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || skip "curl 未安装"
command -v docker >/dev/null 2>&1 || skip "docker 未安装"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  skip "Brain container ${BRAIN_CONTAINER} 未运行"
fi

# Health check
if ! curl -sf "${BRAIN_URL}/api/brain/health" >/dev/null 2>&1; then
  if ! curl -sf "${BRAIN_URL}/health" >/dev/null 2>&1; then
    skip "Brain ${BRAIN_URL} 不健康（health 端点 5xx/无响应）"
  fi
fi

log "前置 OK — Brain ${BRAIN_URL} 健康"

# ── 2. retry-policies 模块在容器内可 import ────────────────────────────────
docker exec "$BRAIN_CONTAINER" node -e "
  import('./src/workflows/retry-policies.js').then((m) => {
    if (!m.LLM_RETRY || !m.DB_RETRY || !m.NO_RETRY) {
      console.error('exports missing'); process.exit(1);
    }
    if (m.LLM_RETRY.maxAttempts !== 3) { console.error('LLM_RETRY.maxAttempts not 3'); process.exit(1); }
    if (m.DB_RETRY.maxAttempts !== 2) { console.error('DB_RETRY.maxAttempts not 2'); process.exit(1); }
    if (m.NO_RETRY.maxAttempts !== 1) { console.error('NO_RETRY.maxAttempts not 1'); process.exit(1); }
    if (typeof m.LLM_RETRY.retryOn !== 'function') { console.error('retryOn missing'); process.exit(1); }
    if (m.LLM_RETRY.retryOn(new Error('HTTP 401 invalid'))) { console.error('LLM_RETRY 401 should not retry'); process.exit(1); }
    if (!m.LLM_RETRY.retryOn(new Error('ECONNRESET'))) { console.error('LLM_RETRY ECONNRESET should retry'); process.exit(1); }
    console.log('retry-policies OK');
  }).catch((e) => { console.error(e.message); process.exit(2); });
" || fail "retry-policies module check failed"

log "✅ retry-policies module 可 import + 行为正确"

# ── 3. /api/brain/harness-interrupts GET ───────────────────────────────────
HTTP_CODE=$(curl -s -o /tmp/harness-interrupts-get.json -w '%{http_code}' "${BRAIN_URL}/api/brain/harness-interrupts" || echo 000)
if [[ "$HTTP_CODE" != "200" ]]; then
  cat /tmp/harness-interrupts-get.json 2>/dev/null || true
  fail "GET /api/brain/harness-interrupts 返回 $HTTP_CODE"
fi
if ! grep -q '"interrupts"' /tmp/harness-interrupts-get.json; then
  cat /tmp/harness-interrupts-get.json
  fail "GET /api/brain/harness-interrupts 响应缺 'interrupts' 字段"
fi
log "✅ GET /api/brain/harness-interrupts → 200, 含 interrupts 字段"

# ── 4. /api/brain/harness-interrupts/:taskId/resume 边界 ───────────────────
DUMMY_TASK_ID="00000000-0000-0000-0000-000000000abc"

# 缺 decision → 400
HTTP_CODE=$(curl -s -o /tmp/resume-empty.json -w '%{http_code}' \
  -X POST "${BRAIN_URL}/api/brain/harness-interrupts/${DUMMY_TASK_ID}/resume" \
  -H 'content-type: application/json' \
  --data '{}' || echo 000)
if [[ "$HTTP_CODE" != "400" ]]; then
  cat /tmp/resume-empty.json 2>/dev/null || true
  fail "POST resume 缺 decision 应返 400, 实际 $HTTP_CODE"
fi
log "✅ POST resume 缺 decision → 400"

# 非法 action → 400
HTTP_CODE=$(curl -s -o /tmp/resume-bad.json -w '%{http_code}' \
  -X POST "${BRAIN_URL}/api/brain/harness-interrupts/${DUMMY_TASK_ID}/resume" \
  -H 'content-type: application/json' \
  --data '{"decision":{"action":"nuke_everything"}}' || echo 000)
if [[ "$HTTP_CODE" != "400" ]]; then
  cat /tmp/resume-bad.json 2>/dev/null || true
  fail "POST resume 非法 action 应返 400, 实际 $HTTP_CODE"
fi
log "✅ POST resume 非法 action → 400"

# ── 5. 总结 ────────────────────────────────────────────────────────────────
log "PASS — 所有 W2+W5 端点行为符合预期"
exit 0
