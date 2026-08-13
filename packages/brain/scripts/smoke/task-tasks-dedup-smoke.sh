#!/usr/bin/env bash
# task-tasks-dedup-smoke.sh
# 验证 POST /api/brain/tasks 服务端去重护栏：同 title+status(queued/in_progress) 返回 200+deduplicated:true
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
BASE_SHA="$(git rev-parse HEAD)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── task-tasks dedup guard smoke ──"

TITLE="smoke-dedup-$$-$(date +%s)"

# 1. 第一次创建 → 201
r1=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$TITLE\",\"task_type\":\"dev\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\"}") || { fail "POST /tasks 不可达"; r1="000"; }
[[ "$r1" == "201" ]] && ok "首次创建返回 201" || fail "首次创建返回 $r1（期望 201）"

# 2. 第二次同 title → 200 + deduplicated:true
r2=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$TITLE\",\"task_type\":\"dev\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\"}") || { fail "第二次 POST 不可达"; r2="{}"; }
STATUS2=$(echo "$r2" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{console.log(JSON.parse(d).deduplicated)}catch(e){console.log('err')} })")
[[ "$STATUS2" == "true" ]] && ok "重复注册返回 deduplicated:true" || fail "deduplicated 字段异常：$STATUS2"

HTTP2=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$TITLE\",\"task_type\":\"dev\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\"}") || HTTP2="000"
[[ "$HTTP2" == "200" ]] && ok "重复注册返回 HTTP 200" || fail "重复注册返回 HTTP $HTTP2（期望 200）"

# 3. 清理：取消该任务（防止污染队列）
ID=$(curl -sf "$BRAIN/api/brain/tasks?status=queued&limit=100" \
  | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{const t=JSON.parse(d).find(t=>t.title==='$TITLE'); console.log(t?t.id:'')}catch(e){console.log('')} })")
if [[ -n "$ID" ]]; then
  curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" \
    -H "Content-Type: application/json" \
    -d '{"status":"cancelled"}' >/dev/null 2>&1 && ok "测试任务已清理 ($ID)" || ok "清理尝试（可忽略）"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
