#!/usr/bin/env bash
# headless-smoke.sh — headless dispatch pipeline smoke（bash+curl+python3 only）
# Sprint: sprints/07240625-relay-fa59d318 | task: fa59d318
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
echo "── headless dispatch smoke ── Brain: $BRAIN_URL"

# A1: /healthz → 200
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/healthz" 2>/dev/null || echo "000")
[ "$HTTP" = "200" ] && ok "A1: GET /healthz → 200" || { fail "A1: GET /healthz → $HTTP"; exit 1; }

# A2: POST tasks(mode=headless) → id
RESP=$(curl -sf -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-probe-test","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"headless"}}' 2>/dev/null) \
  || { fail "A2: POST tasks 失败"; exit 1; }
TASK_ID=$(python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))" <<< "$RESP" 2>/dev/null || echo "")
[ -n "$TASK_ID" ] && ok "A2: POST tasks → id=$TASK_ID" || { fail "A2: 响应无 id: $RESP"; exit 1; }

# A3: payload.mode == "headless"
GET_RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID" 2>/dev/null) || { fail "A3: GET tasks/$TASK_ID 失败"; FAIL=$((FAIL+1)); }
MODE=$(python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('payload',{}).get('mode',''))" <<< "$GET_RESP" 2>/dev/null || echo "")
[ "$MODE" = "headless" ] && ok "A3: payload.mode == headless" || fail "A3: payload.mode='$MODE'（期望 headless）"

# A4: 静态断言 executor-contracts.js harness_initiative→relay-container
CF="${CONTRACTS_FILE:-$(dirname "$0")/../../src/executor-contracts.js}"
for f in "$CF" "/workspace/packages/brain/src/executor-contracts.js" "packages/brain/src/executor-contracts.js"; do
  [ -f "$f" ] && CF="$f" && break
done
python3 -c "
import sys; c=open(sys.argv[1]).read(); ls=c.split('\n')
found=any('harness_initiative' in l and 'relay-container' in l for l in ls)
if not found:
    i=next((i for i,l in enumerate(ls) if 'harness_initiative' in l),None)
    found=i is not None and any('relay-container' in l for l in ls[max(0,i-1):i+4])
assert found,'harness_initiative->relay-container 映射未找到'; print('PASS')
" "$CF" && ok "A4: harness_initiative→relay-container 静态映射存在" || fail "A4: 静态断言失败"

# A5: PATCH status=failed（探针清理）
CC=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN_URL/api/brain/tasks/$TASK_ID" \
  -H "Content-Type: application/json" -d '{"status":"failed"}' 2>/dev/null || echo "000")
[ "$CC" = "200" ] && ok "A5: PATCH status=failed → 200" || fail "A5: PATCH → $CC（期望 200）"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[ $FAIL -eq 0 ] && echo "✅ headless smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
