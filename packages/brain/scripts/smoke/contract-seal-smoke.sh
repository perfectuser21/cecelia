#!/usr/bin/env bash
# contract-seal-smoke.sh —— 第 57 批 contract-seal 薄端点真环境冒烟（V4 seal 工具面）。
# 真库真路径（第 55 批教训：涉真表列的 SQL 必须让真库冒烟走到）：
#   1) 缺参 → 400 结构化
#   2) 坐标形状合法但产物不存在 → 409 contract_seal_rejected（不许吞成 500）
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TOKEN="${BRAIN_INTERNAL_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v docker >/dev/null 2>&1; then
  TOKEN=$(docker exec cecelia-node-brain printenv CECELIA_INTERNAL_TOKEN 2>/dev/null || true)
fi
AUTH=(); [ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")

echo "🔍 contract-seal smoke — $BRAIN_URL"
URL="$BRAIN_URL/api/brain/harness/attempt-run/contract-seal"

PROBE=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{}')
if [ "$PROBE" = "404" ]; then
  echo "⚠️  端点未部署（Brain 版本落后于本 PR），软跳过；部署后由 post-deploy smoke 真跑"
  exit 0
fi
[ "$PROBE" = "400" ] || { echo "::error::空 body 应 400，得到 $PROBE"; exit 1; }

CODE2=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"run_id":"00000000-0000-4000-8000-000000000000","sprint_dir":"sprints/x","branch":"cp-x","approved_sha":"zzz"}')
[ "$CODE2" = "400" ] || { echo "::error::非法 approved_sha 应 400，得到 $CODE2"; exit 1; }

RESP=$(curl -s -m 60 "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"run_id":"00000000-0000-4000-8000-000000000000","sprint_dir":"sprints/contract-seal-smoke-nonexistent","branch":"cp-contract-seal-smoke","approved_sha":"0000000000000000000000000000000000000000"}')
ERR=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error") or "")' 2>/dev/null || echo parse_error)
if [ "$ERR" != "contract_seal_rejected" ]; then
  echo "::error::不存在的产物坐标应 409 contract_seal_rejected，得到：$RESP"
  exit 1
fi
echo "✅ contract-seal smoke 通过：400 参数闸 + 409 机械拒绝结构化"
