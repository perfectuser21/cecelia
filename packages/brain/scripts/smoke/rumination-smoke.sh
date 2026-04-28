#!/usr/bin/env bash
# Smoke: rumination LLM fallback fix — PROBE_FAIL_RUMINATION
# 验证：POST /api/brain/rumination/force → DB 产生 rumination_output 或返回 ok
# 注意：rumination 需有 undigested learnings 才能产生 output；
#       无 learnings 时返回 {"processed":0} 也是健康状态
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[rumination-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[rumination-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[rumination-smoke] Brain 健康 ✓"

echo "[rumination-smoke] 2. 检查 rumination provider 配置（必须为 anthropic-api 或 anthropic，不能是 codex）"
PROVIDER=$(psql -U cecelia -d cecelia -t -c "SELECT config->'rumination'->>'provider' FROM model_profiles WHERE is_active = true LIMIT 1;" 2>/dev/null | tr -d ' \n' || true)
if [[ "$PROVIDER" == "codex" || "$PROVIDER" == "openai" ]]; then
  echo "[rumination-smoke] FAIL: rumination provider=${PROVIDER}（错误配置）"
  exit 1
fi
echo "[rumination-smoke] rumination provider=${PROVIDER:-<not-configured>} ✓"

echo "[rumination-smoke] 3. 触发强制反刍"
RESULT=$(curl -sf -X POST "${BRAIN_URL}/api/brain/rumination/force" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo '{"error":"curl_failed"}')
echo "[rumination-smoke] force rumination result: ${RESULT}"

# 若返回 error 字段，则失败
ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "parse_error")
if [[ -n "$ERROR" && "$ERROR" != "None" && "$ERROR" != "" ]]; then
  echo "[rumination-smoke] FAIL: rumination force error=${ERROR}"
  exit 1
fi

# processed=0 表示无 learnings 可处理（CI 新 DB 正常状态），直接通过
PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('processed',0))" 2>/dev/null || echo "0")
if [[ "$PROCESSED" == "0" ]]; then
  echo "[rumination-smoke] processed=0（CI 新 DB 无 learnings），跳过心跳检查"
  echo "[rumination-smoke] PASS ✓"
  exit 0
fi

echo "[rumination-smoke] 4. 验证最近 60s 有 rumination_run 心跳"
COUNT=$(psql -U cecelia -d cecelia -t -c "
  SELECT COUNT(*) FROM cecelia_events
  WHERE event_type = 'rumination_run'
    AND created_at > NOW() - INTERVAL '60 seconds';
" 2>/dev/null | tr -d ' \n' || true)
if [[ -z "$COUNT" || "$COUNT" -eq 0 ]]; then
  echo "[rumination-smoke] FAIL: 无近期 rumination_run 心跳（可能 LLM 调用前就失败了）"
  exit 1
fi
echo "[rumination-smoke] rumination_run 心跳 count=${COUNT} ✓"

echo "[rumination-smoke] PASS ✓"
