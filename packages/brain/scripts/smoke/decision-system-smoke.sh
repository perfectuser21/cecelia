#!/usr/bin/env bash
# decision-system-smoke.sh — Decision System 地基真环境验证
# 覆盖：POST /api/brain/decisions（写 ability 级决策）+ GET /api/brain/abilities/:id/decisions
# （读决策清单）+ buildDecisionNotionProperties 纯函数导出
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── decision-system API smoke ──"

# 1. 取一个真实 ability 当 target；空环境（CI fresh DB）则用 API 自建一个 fixture
AB=$(curl -sf "$BRAIN/api/brain/abilities?kind=ability&limit=1" | jq -r '.[0].id // empty')
if [ -z "$AB" ]; then
  AB=$(curl -sf -X POST "$BRAIN/api/brain/abilities" -H "Content-Type: application/json" \
    -d '{"name":"smoke-seed-ability","kind":"ability","status":"planned"}' | jq -r '.id // empty')
fi
[ -n "$AB" ] && ok "ability fixture: $AB" || fail "无法取得/创建 kind=ability 的 journey_features"

# 2. POST 一条 ability 级决策 → 期望 201 + 返回 id
RESP=$(curl -sf -X POST "$BRAIN/api/brain/decisions" -H "Content-Type: application/json" \
  -d "{\"category\":\"nfr\",\"topic\":\"smoke\",\"decision\":\"smoke-check\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}") \
  || { fail "POST /decisions 不可达"; RESP="{}"; }
DEC_ID=$(echo "$RESP" | jq -r '.id // empty')
[ -n "$DEC_ID" ] && ok "POST /decisions → id=$DEC_ID" || fail "POST /decisions 未返回 id"
echo "$RESP" | jq -e '.level=="ability" and .scope=="v1"' >/dev/null 2>&1 && ok "level/scope 回显正确" || fail "回显字段错"

# 3. GET 该 ability 的 v1 决策清单 → 期望数组含刚写入决策
LIST=$(curl -sf "$BRAIN/api/brain/abilities/$AB/decisions?scope=v1") || { fail "GET decisions 不可达"; LIST="[]"; }
echo "$LIST" | jq -e --arg id "$DEC_ID" 'any(.[]; .id == $id)' >/dev/null 2>&1 && ok "GET 清单含刚写入决策" || fail "清单缺刚写入决策"
echo "$LIST" | jq -e 'all(.[]; .scope == "v1")' >/dev/null 2>&1 && ok "scope=v1 过滤生效" || fail "scope 过滤失效"

# 4. 非法 level → 400
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/decisions" -H "Content-Type: application/json" \
  -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"galaxy\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}")
[ "$C" = "400" ] && ok "非法 level → 400" || fail "非法 level 期望 400，实际 $C"

# 5. buildDecisionNotionProperties 纯函数导出
NPS="$(cd "$(dirname "$0")/../../src" && pwd)/notion-push-sync.js"
node --input-type=module -e "import('file://$NPS').then(m=>{if(typeof m.buildDecisionNotionProperties!=='function')process.exit(1)}).catch(()=>process.exit(1))" \
  && ok "buildDecisionNotionProperties 已导出" || fail "buildDecisionNotionProperties 未导出"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
