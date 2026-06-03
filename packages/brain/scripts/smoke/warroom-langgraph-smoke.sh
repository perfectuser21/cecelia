#!/usr/bin/env bash
# warroom-langgraph-smoke.sh
# 验收：战情室 feed 给每个 sprint（kind==='sprint'）挂上 LangGraph 富数据
#   （node_label / stages / gan_rounds / ws_verdicts ...，join harness-pipelines）。
# CI 环境 feed 可能为空 —— 此时验"端点可用 + 响应形状正确"，不强求有 sprint。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# 1. feed 端点返回 200 + JSON（areas 数组存在）
echo "── warroom/feed 可用性 ──"
BODY="$(curl -s "$API/warroom/feed?days=30")"
echo "$BODY" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try { j=JSON.parse(s); } catch(e){ console.error("not json"); process.exit(1); }
    if (!Array.isArray(j.areas)) { console.error("areas not array"); process.exit(1); }
    process.exit(0);
  });
' && ok "GET /warroom/feed → 200 + areas[]" || fail "GET /warroom/feed 响应非法"

# 2. 校验：所有 sprint（kind==='sprint'）feed item 必须携带 LangGraph 契约字段键。
#    （键存在性，不校验具体值 —— CI 库可能无 sprint，则该断言天然通过。）
echo "── sprint feed item 携带 lg 契约字段 ──"
echo "$BODY" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j = JSON.parse(s);
    const items = (j.areas||[]).flatMap(a => (a.groups||[]).flatMap(g => g.tasks||[]));
    const sprints = items.filter(t => t.kind === "sprint");
    const REQUIRED = ["node_label","gan_rounds","fix_rounds","review_round","eval_round","stages","ws_verdicts","last_error","pr_urls"];
    let bad = 0;
    for (const sp of sprints) {
      for (const k of REQUIRED) {
        if (!(k in sp)) { console.error("sprint", sp.id, "缺字段", k); bad++; }
      }
    }
    // 非 sprint 任务这些富字段也应为键存在但值 null（契约：非 sprint 不带富数据）
    const nonSprint = items.filter(t => t.kind !== "sprint");
    for (const t of nonSprint) {
      if (t.node_label !== null && t.node_label !== undefined) { console.error("non-sprint", t.id, "不应有 node_label"); bad++; }
      if (t.stages !== null && t.stages !== undefined) { console.error("non-sprint", t.id, "不应有 stages"); bad++; }
    }
    console.error("sprint 数:", sprints.length, "非sprint数:", nonSprint.length, "问题数:", bad);
    process.exit(bad === 0 ? 0 : 1);
  });
' && ok "所有 sprint 带 node_label/stages 等契约字段；非 sprint 富字段为 null" || fail "sprint lg 契约字段缺失"

# 3. stages 形状校验：若存在带 stages 的 sprint，每个 stage 必须是 {key,label,status,elapsed_ms}。
echo "── stages 形状归一校验 ──"
echo "$BODY" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j = JSON.parse(s);
    const items = (j.areas||[]).flatMap(a => (a.groups||[]).flatMap(g => g.tasks||[]));
    const ALLOWED = new Set(["done","running","pending","failed"]);
    let bad = 0, checked = 0;
    for (const t of items) {
      if (!Array.isArray(t.stages)) continue;
      for (const st of t.stages) {
        checked++;
        for (const k of ["key","label","status","elapsed_ms"]) {
          if (!(k in st)) { console.error("stage 缺", k, "@", t.id); bad++; }
        }
        if (st.status && !ALLOWED.has(st.status)) { console.error("stage status 非法:", st.status); bad++; }
      }
    }
    console.error("校验 stage 数:", checked, "问题:", bad);
    process.exit(bad === 0 ? 0 : 1);
  });
' && ok "stages 归一为 {key,label,status,elapsed_ms}，status ∈ {done,running,pending,failed}" || fail "stages 形状不符契约"

echo ""
echo "── 结果：PASS=$PASS FAIL=$FAIL ──"
[[ "$FAIL" -eq 0 ]] || exit 1
