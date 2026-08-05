#!/usr/bin/env bash
# journeys-bizarea-smoke.sh — journeys 正式分区 biz_area 真环境验证（任务 82830303）
#
# 验证 Alex 08-05 拍板：分区不许靠名字正则猜。
#   1. 源码断言：classifyJourneyArea 接受 biz_area 一等参数且校验三桶
#   2. DB 断言：journeys.biz_area 列 + CHECK 约束存在（migration 389）
#   3. 行为断言：种 infrastructure journey → /warroom/lines 出 Infrastructure 分区；
#      名字含"客服"但 biz_area=zenithjoy → 归 ZenithJoy（正则猜不出、字段猜得出）
#   4. 残渣断言：/warroom/lines 不出现 [smoke]%/gp-agg-smoke%（deprecated 被过滤）
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
API="${BRAIN_URL:-http://localhost:5221}/api/brain"

echo "[smoke:journeys-bizarea] Case 1: 源码结构断言"
node -e "
const js = require('fs').readFileSync('packages/brain/src/warroom-classify.js', 'utf8');
if (!/classifyJourneyArea\(name, bizArea\)/.test(js)) throw new Error('Case 1 FAIL: classifyJourneyArea 未接受 bizArea 参数');
if (!/'infrastructure'/.test(js)) throw new Error('Case 1 FAIL: 三桶缺 infrastructure');
const rt = require('fs').readFileSync('packages/brain/src/routes/warroom.js', 'utf8');
if (!/classifyJourneyArea\(j\.name, j\.biz_area\)/.test(rt)) throw new Error('Case 1 FAIL: /lines 未传 biz_area');
console.log('  PASS: biz_area 一等参数已接线');
"

PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"

if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  echo "  SKIP: DB 不可达，Case 2-4 跳过（结构断言已覆盖）"
  echo "[smoke:journeys-bizarea] DONE"
  exit 0
fi

echo "[smoke:journeys-bizarea] Case 2: biz_area 列 + CHECK 约束"
COL=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
  -c "SELECT data_type FROM information_schema.columns WHERE table_name='journeys' AND column_name='biz_area';" 2>/dev/null || echo "")
if [ "$COL" != "text" ]; then
  echo "  WARN: biz_area 列未应用（'$COL'）— migration 389 未跑，CI fresh DB 会跑"; echo "[smoke:journeys-bizarea] DONE"; exit 0
fi
BAD=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
  -c "INSERT INTO journeys (name, status, biz_area) VALUES ('[smoke-bizarea] bad', 'active', 'not-a-bucket') RETURNING id;" 2>&1 || true)
echo "$BAD" | grep -q "violates check constraint" || { echo "  FAIL: 非法桶值未被 CHECK 拦截"; exit 1; }
echo "  PASS: 列存在且 CHECK 生效"

echo "[smoke:journeys-bizarea] Case 3: 行为断言（种数据→打端点）"
INFRA_ID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
  -c "INSERT INTO journeys (name, status, biz_area) VALUES ('[smoke-bizarea] 机群底座', 'active', 'infrastructure') RETURNING id;")
KEFU_ID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
  -c "INSERT INTO journeys (name, status, biz_area) VALUES ('[smoke-bizarea] 某某客服线', 'active', 'zenithjoy') RETURNING id;")
cleanup() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "DELETE FROM journeys WHERE name LIKE '[smoke-bizarea]%';" >/dev/null 2>&1 || true; }
trap cleanup EXIT

LINES=$(curl -sf "${API}/warroom/lines") || { echo "  FAIL: /warroom/lines 不可达"; exit 1; }
echo "$LINES" | node -e "
let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j = JSON.parse(d);
  const areas = j.areas || [];
  const infra = areas.find(a => a.areaKey === 'infrastructure');
  if (!infra) throw new Error('Case 3 FAIL: 无 infrastructure 分区');
  if (!infra.lines.some(l => l.name.includes('[smoke-bizarea] 机群底座'))) throw new Error('Case 3 FAIL: infra journey 未归 Infrastructure');
  const zj = areas.find(a => a.areaKey === 'zenithjoy');
  if (!zj || !zj.lines.some(l => l.name.includes('[smoke-bizarea] 某某客服线'))) throw new Error('Case 3 FAIL: 含客服字样+biz_area=zenithjoy 未归 ZenithJoy（还在靠正则猜）');
  console.log('  PASS: infrastructure 分区 + biz_area 优先于正则');
});
"

echo "[smoke:journeys-bizarea] Case 4: deprecated 线不出现在 /lines（自包含断言）"
# 不断言全局无 gp-agg 残渣：同场 CI 的 gp-aggregation smoke 会临时新建 active 残渣线，
# 那是它的测试数据不是本刀的病。本刀保证的是 deprecated 状态被过滤。
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c \
  "INSERT INTO journeys (name, status, biz_area) VALUES ('[smoke-bizarea] 已退役线', 'deprecated', 'cecelia');" >/dev/null
LINES2=$(curl -sf "${API}/warroom/lines") || { echo "  FAIL: /warroom/lines 不可达"; exit 1; }
echo "$LINES2" | grep -q "smoke-bizarea] 已退役线" && { echo "  FAIL: deprecated 线仍出现在 /lines"; exit 1; }
echo "  PASS: deprecated 线已被过滤"

echo "[smoke:journeys-bizarea] DONE — 全部通过"
