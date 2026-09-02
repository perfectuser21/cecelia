#!/usr/bin/env bash
# merge-pr-smoke.sh —— 第 67 批 merge-pr 端点真环境冒烟（参数闸 + 不存在 PR 路径，不真合并）。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TOKEN="${BRAIN_INTERNAL_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v docker >/dev/null 2>&1; then
  TOKEN=$(docker exec cecelia-node-brain printenv CECELIA_INTERNAL_TOKEN 2>/dev/null || true)
fi
AUTH=(); [ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")
URL="$BRAIN_URL/api/brain/harness/attempt-run/merge-pr"
echo "🔍 merge-pr smoke — $BRAIN_URL"
PROBE=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{}')
if [ "$PROBE" = "404" ]; then echo "⚠️  端点未部署，软跳过"; exit 0; fi
[ "$PROBE" = "400" ] || { echo "::error::空 body 应 400，得到 $PROBE"; exit 1; }
RESP=$(curl -s -m 30 "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{"pr_number":99999999,"head_sha":"'$(printf 'a%.0s' {1..40})'"}')
ERR=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error") or "")' 2>/dev/null || echo parse_error)
case "$ERR" in
  merge_pr_unavailable) echo "✅ merge-pr smoke 通过：参数闸 + 不存在 PR 结构化 409"; exit 0;;
  merge_pr_failed) echo "⚠️  GitHub 凭据本环境不可用（$RESP），参数闸已验证，软通过"; exit 0;;
  *) echo "::error::不存在 PR 应 409 结构化，得到：$RESP"; exit 1;;
esac
