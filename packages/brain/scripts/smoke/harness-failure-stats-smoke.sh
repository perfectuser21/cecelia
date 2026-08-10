#!/usr/bin/env bash
# harness-failure-stats-smoke.sh — 真环境验证：harness 失败可观测地基（决策 e8f6134f 交付物2）。
# 打运行中的 Brain（real-env-smoke 从本 PR 代码构建的容器）+ 真 Postgres，验证：
#   1. GET /api/brain/harness/failure-stats?days=7 → 200 + failure_rate(number) + by_class(object) + 计量字段
#   2. 非法 days=abc → 400 + error 字段（不 500 / 不静默空口径）
#   3. 机械闸 lint 干净树 exit 0
#   4. 共享 helper 模块导出受控冻结枚举 + 规范化行为
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 1. failure-stats?days=7 → 200，字段齐全，禁用字段 period_days 不出现
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/failure-stats?days=7")
echo "$RESP" | jq -e '.failure_rate | type == "number"' >/dev/null || { echo "FAIL: failure_rate 非数值 — $RESP"; exit 1; }
echo "$RESP" | jq -e '.by_class | type == "object"' >/dev/null || { echo "FAIL: by_class 非对象 — $RESP"; exit 1; }
echo "$RESP" | jq -e 'has("total_tasks") and has("terminal_failed_count") and has("window_days")' >/dev/null || { echo "FAIL: 缺计量字段 — $RESP"; exit 1; }
echo "$RESP" | jq -e 'has("period_days") | not' >/dev/null || { echo "FAIL: 禁用字段 period_days 漏网 — $RESP"; exit 1; }

# 2. 非法 days → 400 + error 字段
CODE=$(curl -s -o /tmp/fs-smoke-err.json -w "%{http_code}" "$BRAIN_URL/api/brain/harness/failure-stats?days=abc")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 days 未返 400（got=$CODE）"; exit 1; }
jq -e '.error | type == "string"' /tmp/fs-smoke-err.json >/dev/null || { echo "FAIL: 400 body 缺 error 字段"; exit 1; }

# 3. 机械闸 lint 干净树 exit 0
node packages/brain/scripts/lint/lint-terminal-failure-class.mjs >/dev/null || { echo "FAIL: 干净树 lint 非 0"; exit 1; }

# 4. helper 模块导出受控冻结枚举 + 规范化
node --input-type=module -e 'import { FAILURE_CLASSES, normalizeFailureClass } from "./packages/brain/src/harness-failure-class.js"; if(!Object.isFrozen(FAILURE_CLASSES)) process.exit(1); if(normalizeFailureClass("free text xyz")!=="unclassified") process.exit(1); if(normalizeFailureClass("watchdog_deadline")!=="watchdog_deadline") process.exit(1);' || { echo "FAIL: helper 导出/规范化异常"; exit 1; }

echo "HARNESS_FAILURE_STATS_SMOKE_PASS"
