#!/usr/bin/env bash
# f1-capability-certification-smoke.sh
#
# F1 Capability 可重复认证闭环 smoke（真 Brain + 真 PG，禁 mock 被改的边）。
# 由 smoke-glob-runner 在 cecelia_test + Brain 容器（同库）环境执行；
# 亦可本地 BRAIN_URL/DATABASE_URL 指向真实 Brain 手动跑。
#
# 正向：seed green → 端点回读 state=green + synthetic=false + receipt_id 非空。
# 反向：no_receipt / wrong_sha / missing_feature / no_contract 一律 fail-closed 不 green。

set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
SEED="packages/brain/scripts/integration/seed-f1-cert-fixture.js"
GP_ID="48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3"
GP_HASH="3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8"
JOURNEY_ID="e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29"
STEP_ID="aad25bdb-bdd6-47f4-9a99-e1176e23ac8b"

certify() {
  # $1 = expected_merge_sha, $2 = gp_contract_hash
  curl -sf "${BRAIN}/api/brain/capabilities/F1/certification?gp_contract_id=${GP_ID}&gp_contract_version=1&gp_contract_hash=$2&journey_id=${JOURNEY_ID}&step_id=${STEP_ID}&expected_merge_sha=$1"
}

echo "🔬 F1 certification smoke — BRAIN=$BRAIN"

# 正向 green
GREEN_JSON=$(node "$SEED" green)
MERGE_SHA=$(echo "$GREEN_JSON" | jq -r .source_sha)
RESP=$(certify "$MERGE_SHA" "$GP_HASH")
echo "$RESP" | jq -e '.capability=="F1" and .state=="green" and .synthetic==false and (.receipt_id|type=="string") and .gp_contract_hash=="'"$GP_HASH"'"' >/dev/null \
  || { echo "❌ FAIL green: $RESP"; exit 1; }
echo "✅ green: $(echo "$RESP" | jq -c '{state,reason_code,synthetic}')"

# 反向矩阵：任何一格 green 即失败
for CASE in no_receipt wrong_sha missing_feature no_contract; do
  CJ=$(node "$SEED" "$CASE")
  CM=$(echo "$CJ" | jq -r .source_sha)
  CH=$(echo "$CJ" | jq -r .gp_contract_hash)
  CR=$(certify "$CM" "$CH")
  echo "$CR" | jq -e '.state != "green"' >/dev/null \
    || { echo "❌ FAIL reverse[$CASE] 竟 green: $CR"; exit 1; }
  echo "✅ reverse[$CASE]: $(echo "$CR" | jq -c '{state,reason_code}')"
done

echo "✅ F1 certification smoke passed（正向 green + 四反向 fail-closed）"
