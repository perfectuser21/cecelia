#!/usr/bin/env bash
# coding workflow 任务 bd2b1556-8a14-4042-88dc-e7972ba52075 的真人 QA 验收命令固化（审计 #9）：QA 与独立裁判通过后由 runner 生成，勿手改
# 场景按 spec 要求自己造数据，CI 空库可复现；失败即回归。
set -euo pipefail
# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "== T-1（对应 Q-1）"
TS=$(date +%s%N); R=$(curl -q -s -w '\n%{http_code}' -X POST "$BRAIN_URL"/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && curl -q -s '"$BRAIN_URL"/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | tee /dev/stderr | jq -e '.data == []' && echo Q1_OK

echo "== T-2（对应 Q-2）"
TS=$(date +%s%N); U="$BRAIN_URL"/api/brain/strategic-decisions; check(){ R=$(curl -q -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' --data-binary @-); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); echo "$CODE ${BODY:0:160}"; test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation'; }; for i in 1 2 3; do echo "{\"category\":123,\"topic\":\"qa-num-$TS-$i\",\"decision\":\"qa\"}" | check || exit 1; done; echo "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" | check || exit 1; python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))" | check || exit 1; curl -q -s "$U?category=Decision&limit=10" | jq -e '.data == []' && echo Q2_OK

echo "== T-3（对应 Q-3）"
TS=$(date +%s%N); U="$BRAIN_URL"/api/brain/strategic-decisions; R1=$(curl -q -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); echo "$R1"; R2=$(curl -q -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R2"; test "$(echo "$R1" | tail -n1)" = 201 && test "$(echo "$R2" | tail -n1)" = 201 && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -q -s "$U?category=general&limit=200" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '([.data[] | select(.topic == $a or .topic == $b)] | length) == 2' && echo Q3_OK

echo "== T-4（对应 Q-4）"
TS=$(date +%s%N); U="$BRAIN_URL"/api/brain/strategic-decisions; R=$(curl -q -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 || exit 1; ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id | select(. != null and . != "")') || exit 1; curl -q -s "$U?category=decision&limit=200" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '.data | map(select(.id == $id)) | length == 1 and .[0].topic == $t and .[0].category == "decision"' && echo Q4_OK

echo "== T-5（对应 Q-5）"
TS=$(date +%s%N); U="$BRAIN_URL"/api/brain/strategic-decisions; R=$(curl -q -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 || exit 1; curl -q -s "$U?category=judgment&limit=1000" | jq -e --arg t "判定点[qa$TS#1]: qa" '.data | map(select(.topic == $t)) | length == 1 and .[0].category == "judgment"' && echo Q5_OK

echo "PASS: cw-bd2b1556-qa-smoke.sh"
