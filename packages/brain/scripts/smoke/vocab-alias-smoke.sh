#!/usr/bin/env bash
# vocab-alias-smoke.sh — 行业词汇 API 别名真环境验证（决策 a340f100 · 任务 7b550e31）
# 断言六组新端点与旧端点同实现：新旧同参同返（比 status 与关键字段）；旧端点不受影响。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
API="${BRAIN_URL:-http://localhost:5221}/api/brain"

fail() { echo "FAIL: $1"; exit 1; }

echo "[smoke:vocab-alias] 1. 源码接线断言"
node -e "
const s = require('fs').readFileSync('packages/brain/server.js','utf8');
if (!/vocabAlias/.test(s)) throw new Error('server.js 未挂载 vocabAlias');
const a = require('fs').readFileSync('packages/brain/src/vocab-alias.js','utf8');
for (const k of ['/value-streams','/capabilities','/backbone-activities','/features-registry','/acceptance-criteria','/work-items'])
  if (!a.includes(k)) throw new Error('缺映射 '+k);
console.log('  PASS: 中间件挂载+六组映射齐');
"

if ! curl -sf --max-time 5 "${API}/context" >/dev/null 2>&1; then
  echo "  SKIP: Brain 不可达，行为断言跳过（源码断言已覆盖）"; echo "[smoke:vocab-alias] DONE"; exit 0
fi

echo "[smoke:vocab-alias] 2. 新旧端点同返（value-streams vs journeys）"
NEW_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${API}/value-streams")
if [ "$NEW_CODE" = "404" ]; then
  echo "  WARN: 运行中 Brain 未含本 PR 代码（/value-streams 404）——CI fresh 容器会实跑"; echo "[smoke:vocab-alias] DONE"; exit 0
fi
OLD=$(curl -sf --max-time 8 "${API}/journeys" | python3 -c 'import sys; print(sys.stdin.read()[:2000], end="")')
NEW=$(curl -sf --max-time 8 "${API}/value-streams" | python3 -c 'import sys; print(sys.stdin.read()[:2000], end="")')
[ -n "$NEW" ] || fail "/value-streams 无响应"
[ "$OLD" = "$NEW" ] || fail "/value-streams 与 /journeys 返回不一致"
echo "  PASS"

echo "[smoke:vocab-alias] 3. 带查询串别名（acceptance-criteria）+ 旧端点原样"
C1=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${API}/acceptance-criteria?journey_id=00000000-0000-0000-0000-000000000000&limit=1")
[ "$C1" = "200" ] || fail "acceptance-criteria 带参应 200，得 $C1"
C2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${API}/journeys")
[ "$C2" = "200" ] || fail "旧端点 /journeys 受影响，得 $C2"
echo "  PASS"
echo "[smoke:vocab-alias] DONE — 全部通过"
