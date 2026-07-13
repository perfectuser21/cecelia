#!/usr/bin/env bash
# WarRoom Line 指挥页聚合端点真环境冒烟
# GET /api/brain/warroom/line/:id/command
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── warroom line command smoke ──"

# 自建 throwaway journey，不依赖 seed 数据，CI 空库也能跑
JID=$(curl -sf -X POST "$BRAIN/api/brain/journeys" -H 'Content-Type: application/json' \
  -d '{"name":"[smoke] line-command journey","journey_type":"autonomous","status":"active"}' \
  | jq -r '.id // empty')
[ -n "$JID" ] && ok "throwaway journey=$JID" || { fail "创建 journey 失败"; echo "PASS:$PASS FAIL:$FAIL"; exit 1; }

# 正常返回 200，三块字段齐全
RESP=$(curl -sf "$BRAIN/api/brain/warroom/line/$JID/command")
echo "$RESP" | jq -e '.line.id != null' >/dev/null 2>&1 \
  && ok "返回 line 基本面" || fail "line 字段缺失"
echo "$RESP" | jq -e '.decisions | type == "array"' >/dev/null 2>&1 \
  && ok "decisions 数组存在(空账本优雅降级)" || fail "decisions 字段异常"
echo "$RESP" | jq -e '.connections.abilities != null and .connections.features != null and .connections.advancements != null and .connections.active_tasks != null and .connections.open_issues != null and .connections.recent_runs != null' >/dev/null 2>&1 \
  && ok "connections 六个子字段齐全" || fail "connections 子字段缺失"
echo "$RESP" | jq -e '.health.success_rate == null and .health.run_total == 0' >/dev/null 2>&1 \
  && ok "空账本 health 优雅降级(success_rate=null run_total=0)" || fail "health 计算异常"

# 404：不存在的 journey id
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/warroom/line/00000000-0000-0000-0000-000000000000/command")
[ "$CODE" = "404" ] && ok "不存在的 journey 返回 404" || fail "404 未拦截(got=$CODE)"

echo ""
echo "PASS:$PASS FAIL:$FAIL"
[ "$FAIL" -eq 0 ]
