#!/usr/bin/env bash
# model-accounts-smoke.sh — 模型账号配额+机器可达性投影真环境冒烟（工厂·F5 指挥舱 刀2）
#
# 真起 Brain + 真 PG（real-env-smoke / smoke-ratchet 均注入 BRAIN_URL + DATABASE_URL/PG*）。
# seed 8 行 e2e- 账号快照 → curl GET /agent-ops/model-accounts 验读路径 + 失败隔离 +
# key_expired 语义 + forwardable 静态配置 + agents.model_role，并静态断言 refresh_token 铁律。
# 断言口径与合同 DoD B-01~B-04 / E2E 逐字一致。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
COLLECTOR="$ROOT_DIR/packages/brain/src/ops-model-accounts-collector.js"

echo "🔬 model-accounts-smoke — BRAIN_URL=$BRAIN_URL"

# 1. seed 8 行 e2e- 账号快照（复用 seed 脚本，代表采集器输出）
bash "$ROOT_DIR/packages/brain/scripts/model-accounts-seed-e2e.sh"

# 2. 端点返回本 e2e 前缀 8 条，11 字段齐全，HTTP 200
CODE=$(curl -s -o /tmp/ma-smoke.json -w "%{http_code}" "$BRAIN_URL/api/brain/agent-ops/model-accounts")
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE（单账号失败不该整体非 200）"; exit 1; }
jq -e '[.data.accounts[]|select(.account_id|startswith("e2e-"))]|length==8' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e- 前缀账号数 != 8"; exit 1; }
jq -e '[.data.accounts[]|select(.account_id|startswith("e2e-"))]|all(has("provider") and has("plan") and has("five_hour_pct") and has("seven_day_pct") and has("reset_at") and has("host_alias") and has("forwardable") and has("forward_targets") and has("status") and has("last_checked_at") and has("last_error"))' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: 11 字段不齐"; exit 1; }

# 3. 失败隔离：unknown 带 last_error；no_credential 正确
jq -e '[.data.accounts[]|select(.account_id=="e2e-codex4")]|.[0].status=="unknown" and (.[0].last_error|type=="string")' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e-codex4 应 unknown + last_error 字符串"; exit 1; }
jq -e '[.data.accounts[]|select(.account_id=="e2e-codex5")]|.[0].status=="no_credential"' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e-codex5 应 no_credential"; exit 1; }

# 4. Grok key 过期语义 + refresh_token 铁律（collector 源码非注释行零命中）
jq -e '[.data.accounts[]|select(.account_id=="e2e-grok")]|.[0].status=="key_expired"' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e-grok 应 key_expired"; exit 1; }
HITS=$(grep -nE 'refresh_token' "$COLLECTOR" | grep -vE '^[0-9]+:[[:space:]]*(//|\*|#)' || true)
[ -z "$HITS" ] || { echo "FAIL: collector 非注释行出现 refresh_token: $HITS"; exit 1; }

# 5. forwardable/forward_targets 静态：codex 可转发 / grok 锁本机
jq -e '[.data.accounts[]|select(.account_id=="e2e-codex1")]|.[0].forwardable==true and (.[0].forward_targets|index("xian-m4"))' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e-codex1 forwardable/forward_targets 静态配置不符"; exit 1; }
jq -e '[.data.accounts[]|select(.account_id=="e2e-grok")]|.[0].forwardable==false and (.[0].forward_targets|length==0)' /tmp/ma-smoke.json >/dev/null \
  || { echo "FAIL: e2e-grok 应锁本机（forwardable=false, forward_targets=[]）"; exit 1; }

# 6. agents 端点每条含 model_role 三字段
curl -sf "$BRAIN_URL/api/brain/agent-ops/agents" \
  | jq -e '.data.agents|all(has("model_role") and (.model_role|has("model_id") and has("primary_count") and has("fallback_count")))' >/dev/null \
  || { echo "FAIL: agents 端点缺 model_role 三字段"; exit 1; }

# 7. 清理 e2e- 行（不污染其它 smoke / 端点「恰好 8 条」生产口径）
CONN="${DATABASE_URL:-${DB_URL:-${DB:-}}}"
psql "$CONN" -c "DELETE FROM ops_model_accounts WHERE account_id LIKE 'e2e-%'" >/dev/null 2>&1 || true

echo "✅ model-accounts-smoke 通过（8 条 + 失败隔离 + key_expired 铁律 + forwardable + model_role）"
