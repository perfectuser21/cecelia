#!/usr/bin/env bash
# harness-failure-stats-smoke.sh — harness 失败可观测端点真环境验收（决策 e8f6134f 交付物2）
#
# 验收项（真 Brain 5221，tick 无关，只读端点）：
# [1] GET /api/brain/harness/failure-stats?days=7 → 200 + failure_rate(number)+by_class(object)+total(number)
# [2] drift guard：body 不含禁用字段名 failureRate/byClass/rate/classes
# [3] days=abc（非法）→ 400 + error(string)
# [4] SSOT 枚举模块 harness-failure-class.js 真 import：FAILURE_CLASSES 冻结闭集含 unknown
# SKIP 判据：端点 404 或连不上 → SKIP+WARN 不算 FAIL（本地生产 brain 可能是未部署本 PR 的旧版）；
#           CI real-env-smoke 的 brain 容器从 PR 源码 build，端点存在，断言真跑。
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1"; }

echo "── harness-failure-stats-smoke ──"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

# [4] SSOT 模块纯逻辑（零依赖，永远真跑）
echo "检查 SSOT 枚举模块 harness-failure-class.js..."
if node --input-type=module -e "
import { FAILURE_CLASSES, classifyFailure, buildTerminalFailureResult } from './packages/brain/src/harness-failure-class.js';
if (!Object.isFrozen(FAILURE_CLASSES)) { console.error('not frozen'); process.exit(1); }
if (!FAILURE_CLASSES.includes('unknown')) { console.error('missing unknown'); process.exit(1); }
if (classifyFailure('never_seen_xyz') !== 'unknown') { console.error('fallback broken'); process.exit(1); }
if (buildTerminalFailureResult({ failureClass: 'bad', failureDetail: 'x' }).failure_class !== 'unknown') { console.error('coerce broken'); process.exit(1); }
"; then ok "SSOT 冻结闭集 + unknown 兜底 + 非法降级"; else fail "SSOT 模块逻辑不符"; fi

# [1]-[3] 活端点
echo "检查 GET /harness/failure-stats..."
BODY_FILE="$(mktemp)"
CODE=$(curl -s -o "$BODY_FILE" -w "%{http_code}" "$BRAIN_URL/api/brain/harness/failure-stats?days=7" 2>/dev/null)
CODE="${CODE:-000}"

if [ "$CODE" = "000" ] || [ "$CODE" = "404" ]; then
  warn "端点不可达/未部署（HTTP $CODE）— 跳过活端点断言（旧版 brain 无此端点）"
else
  if [ "$CODE" = "200" ]; then ok "days=7 → HTTP 200"; else fail "days=7 期望 200 实得 $CODE"; fi
  if jq -e '(.failure_rate|type=="number") and (.by_class|type=="object") and (.total|type=="number")' "$BODY_FILE" >/dev/null 2>&1; then
    ok "schema：failure_rate(number)+by_class(object)+total(number)"
  else
    fail "schema 不符：$(cat "$BODY_FILE")"
  fi
  if jq -e '(has("failureRate")|not) and (has("byClass")|not) and (has("rate")|not) and (has("classes")|not)' "$BODY_FILE" >/dev/null 2>&1; then
    ok "drift guard：无 camelCase/禁用字段"
  else
    fail "字段漂移：$(cat "$BODY_FILE")"
  fi
  ECODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/harness/failure-stats?days=abc" 2>/dev/null)
  ECODE="${ECODE:-000}"
  if [ "$ECODE" = "400" ]; then ok "days=abc → HTTP 400（error path）"; else fail "days=abc 期望 400 实得 $ECODE"; fi
fi
rm -f "$BODY_FILE"

echo ""
echo "📊 harness-failure-stats-smoke — 通过: $PASS, 失败: $FAIL"
[ "$FAIL" -eq 0 ]
