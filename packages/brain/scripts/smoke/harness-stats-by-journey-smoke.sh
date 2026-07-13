#!/usr/bin/env bash
# harness-stats-by-journey-smoke.sh
# 验收：战况室数据层 GET /api/brain/harness/stats?by=journey 真环境可用
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. by=journey 返回 200 + JSON 含 by:'journey' + journeys 数组
echo "── stats by=journey ──"
RESP=$(curl -s "$API/harness/stats?by=journey&days=30" --max-time 20)
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness/stats?by=journey&days=30" --max-time 20)
[[ "$CODE" == "200" ]] \
  && ok "GET /harness/stats?by=journey → 200" \
  || fail "GET /harness/stats?by=journey → 期望 200，得 $CODE"

echo "$RESP" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  if (d.by !== 'journey') { console.error('缺 by=journey'); process.exit(1); }
  if (!Array.isArray(d.journeys)) { console.error('缺 journeys 数组'); process.exit(1); }
  if (typeof d.period_days !== 'number') { console.error('缺 period_days'); process.exit(1); }
  // 若有数据，每行须含 runs/success_rate（成功率 0..1）
  for (const j of d.journeys) {
    if (typeof j.runs !== 'number' || typeof j.success_rate !== 'number') { console.error('journey 行字段缺失'); process.exit(1); }
    if (j.success_rate < 0 || j.success_rate > 1) { console.error('success_rate 越界'); process.exit(1); }
  }
" && ok "by=journey 响应结构正确（by/journeys/period_days + runs/success_rate）" \
   || fail "by=journey 响应结构非法"

# 2. 向后兼容：无 by 参数仍返回全局响应（total_pipelines）
echo "── stats 全局（向后兼容）──"
GRESP=$(curl -s "$API/harness/stats" --max-time 20)
echo "$GRESP" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  if (typeof d.total_pipelines !== 'number') { console.error('全局响应缺 total_pipelines'); process.exit(1); }
  if (d.by !== undefined) { console.error('全局响应不应含 by'); process.exit(1); }
" && ok "无 by 参数保持原全局响应" \
   || fail "全局响应回归"

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
