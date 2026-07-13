#!/usr/bin/env bash
# advancement_items 推进项模型真环境冒烟
# 自建 throwaway ability，不依赖 seed 数据，CI 空库也能跑。
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── advancement_items API smoke ──"
# 自建 throwaway ability（POST /abilities 仅需 name）
AB=$(curl -sf -X POST "$BRAIN/api/brain/abilities" -H 'Content-Type: application/json' \
  -d '{"name":"[smoke] advancement ability","kind":"ability"}' | jq -r '.id // empty')
[ -n "$AB" ] && ok "throwaway ability=$AB" || { fail "创建 ability 失败"; echo "PASS:$PASS FAIL:$FAIL"; exit 1; }

# 空账本聚合 total=0 pct=0（现算）
curl -sf "$BRAIN/api/brain/abilities/$AB/advancements" \
  | jq -e '.progress.total == 0 and .progress.pct == 0' >/dev/null 2>&1 \
  && ok "空账本 total=0 pct=0" || fail "空账本聚合异常"

# POST 建推进项
ITEM=$(curl -sf -X POST "$BRAIN/api/brain/abilities/$AB/advancements" -H 'Content-Type: application/json' \
  -d '{"title":"[smoke] 推进项"}' | jq -r '.id // empty')
[ -n "$ITEM" ] && ok "POST 建推进项 id=$ITEM" || fail "POST 建推进项失败"

# PATCH done → done_at 联动
curl -sf -X PATCH "$BRAIN/api/brain/advancements/$ITEM" -H 'Content-Type: application/json' -d '{"status":"done"}' \
  | jq -e '.status=="done" and .done_at != null' >/dev/null 2>&1 \
  && ok "PATCH done + done_at 联动" || fail "PATCH done 异常"

# 聚合现算 done=1 pct=100
curl -sf "$BRAIN/api/brain/abilities/$AB/advancements" \
  | jq -e '.progress.done==1 and .progress.pct==100' >/dev/null 2>&1 \
  && ok "聚合现算 done=1 pct=100" || fail "聚合重算异常"

# 反例：非法 status → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN/api/brain/advancements/$ITEM" \
  -H 'Content-Type: application/json' -d '{"status":"bogus"}')
[ "$CODE" = "400" ] && ok "非法 status 返回 400" || fail "非法 status 未拦截(got=$CODE)"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
