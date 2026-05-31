#!/usr/bin/env bash
# harness-runs-api-smoke.sh
# 验证 GET /api/brain/harness/initiative-runs 端点可用性
# 覆盖场景：默认查询、phase 过滤、limit 校验、journey_id UUID 校验、空结果
set -euo pipefail

BASE="localhost:5221/api/brain/harness/initiative-runs"

echo "[smoke:harness-runs-api] Case 1: 默认请求 → 200 + runs[] + total number"
RESP=$(curl -sf "$BASE")
echo "$RESP" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(!Array.isArray(d.runs)) throw new Error('runs 不是数组');
if(typeof d.total !== 'number') throw new Error('total 不是 number');
if(d.total !== d.runs.length) throw new Error('total != runs.length');
console.log('Case 1 OK: runs=' + d.runs.length);
"

echo "[smoke:harness-runs-api] Case 2: phase=done 过滤 → 每条 phase==done"
RESP=$(curl -sf "$BASE?phase=done")
echo "$RESP" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const bad = d.runs.filter(r=>r.phase!=='done');
if(bad.length>0) throw new Error('存在 phase!=done: ' + JSON.stringify(bad[0]));
console.log('Case 2 OK: ' + d.runs.length + ' 条 phase=done');
"

echo "[smoke:harness-runs-api] Case 3: limit=abc → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?limit=abc")
[ "$CODE" = "400" ] || { echo "FAIL Case 3: 期望 400，实际 $CODE"; exit 1; }
echo "Case 3 OK: limit=abc → 400"

echo "[smoke:harness-runs-api] Case 4: journey_id=not-a-uuid → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?journey_id=not-a-uuid")
[ "$CODE" = "400" ] || { echo "FAIL Case 4: 期望 400，实际 $CODE"; exit 1; }
ERR=$(curl -s "$BASE?journey_id=not-a-uuid")
echo "$ERR" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(d.error !== 'invalid journey_id: must be a UUID') throw new Error('error 字段不符: ' + d.error);
console.log('Case 4 OK: error 字段正确');
"

echo "[smoke:harness-runs-api] Case 5: 空结果 → runs=[] total=0"
RESP=$(curl -sf "$BASE?phase=nonexistent_phase_xyz_smoke_test")
echo "$RESP" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(!Array.isArray(d.runs)||d.runs.length!==0) throw new Error('runs 不是空数组');
if(d.total!==0) throw new Error('total 不是 0');
console.log('Case 5 OK: 空结果');
"

echo "✅ harness-runs-api smoke 全部通过"
