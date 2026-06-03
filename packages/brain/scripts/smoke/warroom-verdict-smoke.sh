#!/usr/bin/env bash
# warroom-verdict-smoke.sh
# 验收：战情室 feed 把 harness_report 的 verdict 合并进对应 sprint
# 验证 feed item 携带 verdict / findings_count 字段（按 initiative_id 关联）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. feed 端点可用
echo "── feed 端点 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/feed")
[[ "$code" == "200" ]] && ok "GET /warroom/feed → 200" || fail "GET /warroom/feed → 得 $code"

# 2. feed item 结构含 verdict / findings_count 字段（值可为 null，但字段必须存在）
echo "── verdict 合并字段 ──"
resp=$(curl -sf "$API/warroom/feed" 2>/dev/null) || resp=""
field_ok=$(printf '%s' "$resp" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const j = JSON.parse(s);
      let sample = null;
      for (const a of j.areas) for (const g of a.groups) for (const t of g.tasks) { sample = t; break; }
      // 字段存在性（合并逻辑已让每个 item 都带 verdict / findings_count 键）
      const good = sample && ("verdict" in sample) && ("findings_count" in sample);
      process.stdout.write(good ? "1" : "0");
    } catch { process.stdout.write("0"); }
  });
' 2>/dev/null || echo 0)
[[ "$field_ok" == "1" ]] \
  && ok "feed item 含 verdict / findings_count 字段" \
  || fail "feed item 缺 verdict / findings_count 字段"

echo "──────────────"
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
