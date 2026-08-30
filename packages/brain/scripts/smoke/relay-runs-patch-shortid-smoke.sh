#!/usr/bin/env bash
# smoke: relay-runs PATCH 短号防呆
set -euo pipefail
BRAIN=${BRAIN_URL:-http://localhost:5221}

# 查询一个活跃的 relay run，取其 initiative_id 前 8 位作为短号测试
SHORT_ID=$(curl -s "$BRAIN/api/brain/orchestrator/relay-runs?limit=1" | jq -r '.[0].initiative_id // empty' | cut -c1-8)
if [ -z "$SHORT_ID" ]; then
  echo "[smoke] 无活跃 relay run，跳过短号测试"
  exit 0
fi
# 用短号 PATCH（只改 phase=planning，最小影响）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/$SHORT_ID" \
  -H "Content-Type: application/json" -d '{"phase":"planning"}')
# 409 也合法：短号已正确解析到 run，被终态冲突/歧义闸拒绝是业务语义（例如 attempt-run
# 冒烟回滚后的 failed run 恰好是最新一条）。本 smoke 只防短号解析失败（400/500）。
[ "$STATUS" = "200" ] || [ "$STATUS" = "404" ] || [ "$STATUS" = "409" ] || { echo "[smoke] FAIL: PATCH 短号返回 $STATUS"; exit 1; }
echo "[smoke] relay-runs-patch-shortid: OK (短号=$SHORT_ID, status=$STATUS)"
