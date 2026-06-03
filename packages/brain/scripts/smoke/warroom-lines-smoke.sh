#!/usr/bin/env bash
# warroom-lines-smoke.sh
# 验收：War Room Line 中心化端点真环境可用
#   GET /api/brain/warroom/lines        → { areas:[{areaKey,areaName,lines:[{step_total,running,...}]}] }
#   GET /api/brain/warroom/line/:id      → { line, steps, tasks }
# CI 空库也能通过：只验端点 200 + 响应字段存在性（不依赖具体数据条数）。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. GET /warroom/lines → 200（route 已挂载）
echo "── warroom lines 端点 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/lines")
[[ "$code" == "200" ]] \
  && ok "GET /warroom/lines → 200" \
  || fail "GET /warroom/lines → 期望 200，得 $code"

# 2. /lines 响应结构：areas[] 每个含 areaKey/areaName/lines[]，lines[] 含 step_total/step_done/running/task_total 字段
echo "── /lines 响应结构 ──"
lines_resp=$(curl -sf "$API/warroom/lines" 2>/dev/null) || lines_resp=""
lines_ok=$(printf '%s' "$lines_resp" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s);
      let good = j && Array.isArray(j.areas);
      // 空库时 areas 可能为空数组——仍算结构 OK；非空时逐字段校验
      for (const a of (j.areas||[])) {
        if (typeof a.areaKey!=="string" || typeof a.areaName!=="string" || !Array.isArray(a.lines)) { good=false; break; }
        for (const l of a.lines) {
          if (!("id" in l) || !("name" in l) || typeof l.step_total!=="number"
              || typeof l.step_done!=="number" || typeof l.running!=="number"
              || typeof l.task_total!=="number" || !("last_activity" in l)) { good=false; break; }
        }
        if (!good) break;
      }
      process.stdout.write(good ? "1" : "0");
    } catch { process.stdout.write("0"); }
  });
' 2>/dev/null || echo 0)
[[ "$lines_ok" == "1" ]] \
  && ok "/lines 含 areas[].lines[] 带 step_total/step_done/running/task_total/last_activity 字段" \
  || fail "/lines 结构不符（areas/lines 字段缺失）"

# 3. GET /warroom/line/:id → 200 + { line, steps, tasks } 结构存在
#    取 /lines 第一条线的 id；空库则跳过该用例（不判失败）。
echo "── /line/:id 响应结构 ──"
first_id=$(printf '%s' "$lines_resp" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s);
      const l=(j.areas||[]).flatMap(a=>a.lines||[])[0];
      process.stdout.write(l && l.id ? String(l.id) : "");
    } catch { process.stdout.write(""); }
  });
' 2>/dev/null || echo "")

if [[ -n "$first_id" ]]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/line/$first_id")
  [[ "$code" == "200" ]] \
    && ok "GET /warroom/line/:id → 200" \
    || fail "GET /warroom/line/:id → 期望 200，得 $code"

  detail=$(curl -sf "$API/warroom/line/$first_id" 2>/dev/null) || detail=""
  detail_ok=$(printf '%s' "$detail" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const j=JSON.parse(s);
        const good = j && j.line && typeof j.line.id==="string"
          && typeof j.line.name==="string" && ("areaName" in j.line)
          && Array.isArray(j.steps) && Array.isArray(j.tasks);
        process.stdout.write(good ? "1" : "0");
      } catch { process.stdout.write("0"); }
    });
  ' 2>/dev/null || echo 0)
  [[ "$detail_ok" == "1" ]] \
    && ok "/line/:id 含 line{id,name,areaName} / steps[] / tasks[]" \
    || fail "/line/:id 结构不符（line/steps/tasks 缺失）"
else
  ok "空库：无 line 可取，跳过 /line/:id（端点已由 /lines 验证挂载）"
fi

# 4. 未知 id → 404（不报 500）
echo "── /line/:id 未知 id ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/line/00000000-0000-0000-0000-000000000000")
[[ "$code" == "404" || "$code" == "200" ]] \
  && ok "GET /warroom/line/<unknown> → ${code}（非 500）" \
  || fail "GET /warroom/line/<unknown> → 期望 404，得 $code"

echo
echo "通过 $PASS / 失败 $FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
