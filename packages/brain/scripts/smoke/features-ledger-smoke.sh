#!/bin/bash
# features-ledger-smoke.sh
# 验证 GET /api/brain/features/ledger 端点返回 11 要素账本结构
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== features-ledger smoke ==="

# 端点可达（返回 domains 结构）
RESULT=$(curl -sf "$BRAIN_URL/api/brain/features/ledger" 2>/dev/null)
echo "$RESULT" | jq -e 'type == "object" and .domains != null' > /dev/null
echo "✅ GET /api/brain/features/ledger — OK ($(echo "$RESULT" | jq '.total') features)"

# 至少有 1 个 domain
echo "$RESULT" | jq -e '(.domains | length) > 0' > /dev/null
echo "✅ domains 非空"

# 取第一个非空 domain 的第一条 item，验证 11 要素字段键存在（契约断言，不依赖数据值）
FIRST_ITEM=$(echo "$RESULT" | jq -c '[.domains[] | select((.items | length) > 0)][0].items[0]')
echo "$FIRST_ITEM" | jq -e '.ledger | has("fr") and has("nfr") and has("invariant") and has("checkpoints_status") and has("freshness_status") and has("death_alert") and has("failure_semantics") and has("effect_confirmed") and has("adversarial") and has("ledger_status") and has("axis_aligned")' > /dev/null
echo "✅ 11 要素字段全部存在"

# generated_at 时间戳存在
echo "$RESULT" | jq -e '.generated_at != null' > /dev/null
echo "✅ generated_at 存在"

echo "✅ features-ledger smoke PASSED"
