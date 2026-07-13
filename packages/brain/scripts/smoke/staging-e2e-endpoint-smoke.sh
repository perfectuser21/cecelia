#!/usr/bin/env bash
# staging-e2e-endpoint-smoke.sh — 刀4 阶段1：staging_e2e 派生端点存在 + 入参校验。
# 只测 400 路径（缺 pr_url），不真建 task 避免 DB 污染。
# proven-to-fire：把路由名改成不存在的跑一次，必须报红（404≠400）。
set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
fail=0
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/harness/staging-e2e" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$code" != "400" ]; then echo "❌ POST /harness/staging-e2e 缺 pr_url 期望 400 实得 $code"; fail=1; fi
if [ "$fail" = "0" ]; then echo "✅ staging-e2e-endpoint smoke 通过（端点存在 + 缺 pr_url 400）"; fi
exit $fail
