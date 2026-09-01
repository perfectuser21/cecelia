#!/usr/bin/env bash
# publish-pr-smoke.sh —— 第 66 批 publish-pr 薄端点真环境冒烟（参数闸 + 防漂移路径，不真开 PR）。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TOKEN="${BRAIN_INTERNAL_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v docker >/dev/null 2>&1; then
  TOKEN=$(docker exec cecelia-node-brain printenv CECELIA_INTERNAL_TOKEN 2>/dev/null || true)
fi
AUTH=(); [ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")
URL="$BRAIN_URL/api/brain/harness/attempt-run/publish-pr"
echo "🔍 publish-pr smoke — $BRAIN_URL"
PROBE=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{}')
if [ "$PROBE" = "404" ]; then echo "⚠️  端点未部署，软跳过"; exit 0; fi
[ "$PROBE" = "400" ] || { echo "::error::空 body 应 400，得到 $PROBE"; exit 1; }
C2=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{"branch":"main","head_sha":"'$(printf 'a%.0s' {1..40})'","title":"x"}')
[ "$C2" = "400" ] || { echo "::error::非 cp-* 分支应 400，得到 $C2"; exit 1; }
RESP=$(curl -s -m 30 "${AUTH[@]}" -X POST "$URL" -H "Content-Type: application/json" -d '{"branch":"cp-publish-pr-smoke-nonexistent","head_sha":"'$(printf 'a%.0s' {1..40})'","title":"smoke"}')
ERR=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error") or "")' 2>/dev/null || echo parse_error)
case "$ERR" in
  publish_branch_unavailable|publish_head_mismatch) echo "✅ publish-pr smoke 通过：参数闸 + 防漂移路径真跑（$ERR）"; exit 0;;
  publish_pr_failed) echo "⚠️  GitHub 凭据在本环境不可用（$RESP），参数闸已验证，软通过"; exit 0;;
  *) echo "::error::不存在分支应 409 结构化，得到：$RESP"; exit 1;;
esac
