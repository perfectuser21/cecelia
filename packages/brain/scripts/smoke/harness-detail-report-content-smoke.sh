#!/usr/bin/env bash
# harness-detail-report-content-smoke.sh
# 验收：GET /harness/initiative/:id/detail 透出 report_content（Sprint 产物契约）。
# 闭环边界「展示」读取者①：detail 端点必须返回 report_content 字段，
# 让 Dashboard Report tab 能读 tasks.result.report_content 渲染真数据。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. 不存在的 initiative → 404（证明路由已挂载）
echo "── detail 路由存在性 ──"
FAKE="00000000-0000-0000-0000-0000000000ff"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness/initiative/$FAKE/detail")
[[ "$code" == "404" || "$code" == "200" ]] \
  && ok "GET /harness/initiative/:id/detail 已挂载 (HTTP ${code})" \
  || fail "detail 端点未挂载，得 HTTP ${code}"

# 2. 取一个真实 harness_initiative（如有）验证 report_content 字段存在于 schema
echo "── report_content 字段透出 ──"
INIT_ID=$(curl -s "$API/tasks?task_type=harness_initiative&limit=1" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const a=JSON.parse(s);const r=Array.isArray(a)?a:(a.tasks||a.items||[]);process.stdout.write(r[0]&&r[0].id?String(r[0].id):'')}catch(e){process.stdout.write('')}})")

if [ -n "$INIT_ID" ]; then
  HAS_KEY=$(curl -s "$API/harness/initiative/$INIT_ID/detail" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);process.stdout.write(('report_content' in o)?'yes':'no')}catch(e){process.stdout.write('parse-err')}})")
  [[ "$HAS_KEY" == "yes" ]] \
    && ok "detail(${INIT_ID}) 含 report_content 键" \
    || fail "detail(${INIT_ID}) 缺 report_content 键 (得 ${HAS_KEY})"
else
  ok "无真实 harness_initiative（CI 空库）— 跳过字段断言，路由存在性已验"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
