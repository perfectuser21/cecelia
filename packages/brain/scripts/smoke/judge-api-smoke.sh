#!/usr/bin/env bash
# judge-api-smoke.sh — 刀2 两端点部署冒烟：路由存在且参数校验生效（空/坏 body 应答 400 而非 404）。
# proven-to-fire 验证法：把 URL 改成不存在的路由名跑一次，必须报红。
set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
fail=0

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/harness/judge" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$code" != "400" ]; then echo "❌ POST /harness/judge 期望 400 实得 $code"; fail=1; fi

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST \
  "$BRAIN/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"phase":"bogus"}')
if [ "$code" != "400" ]; then echo "❌ POST /relay-runs 期望 400 实得 $code"; fail=1; fi

if [ "$fail" = "0" ]; then echo "✅ judge-api smoke 通过（两端点 400 应答正常）"; fi
exit $fail
