---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 9 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T21:11:35Z。全部场景都是 API 场景，没有页面场景，所以没用浏览器、没截图。每条命令都自己造数据（topic 带 `date +%s%N` 时间戳），只按本轮返回的 id/topic 断言。

### T-1
对应: Q-1
verdict: PASS
说明：非法 category 返回 400，error 以「category 非法，合法值：」开头，allowed_categories 含 decision/judgment/general，响应里没有约束名或 SQL 原文；GET ?category=workflow_bogus 的 data 为空。
```command
bash -c 'set -e; TS=$(date +%s%N); B=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed "\$d"); [ "$CODE" = "400" ] || exit 1; echo "$BODY" | jq -e ".success == false and (.error | startswith(\"category 非法，合法值：\")) and (.allowed_categories | length > 0) and (.allowed_categories | index(\"decision\") != null and index(\"judgment\") != null and index(\"general\") != null)" || exit 1; if echo "$BODY" | grep -iqE "decisions_category_chk|check constraint|violates|relation"; then echo LEAK; exit 1; fi; G=$(curl -s "$B?category=workflow_bogus&limit=10"); echo "$G"; echo "$G" | jq -e ".data == []"'
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
{"success":true,"data":[],"total":0}
true
```

### T-2
对应: Q-2
verdict: PASS
说明：`category:123` 连发 4 次（原样 1 次 + 重复 3 次）、`"Decision"`、5000 个 `a` 的长串，全部 400，响应都带非空 allowed_categories，都没有约束名或 SQL 原文；重复发送结果一样；GET ?category=Decision 的 data 为空。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; chk() { R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" --data-binary "$1"); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed "\$d"); echo "$CODE $(echo "$BODY" | cut -c1-120)"; [ "$CODE" = "400" ] || exit 1; echo "$BODY" | jq -e "(.allowed_categories | type == \"array\" and length > 0) and .success == false" >/dev/null || exit 1; if echo "$BODY" | grep -iqE "decisions_category_chk|check constraint|violates|relation"; then echo LEAK; exit 1; fi; }; TS=$(date +%s%N); for i in 1 2 3 4; do chk "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}"; done; chk "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}"; chk "$(python3 -c "import json;print(json.dumps({\"category\":\"a\"*5000,\"topic\":\"qa-long-$TS\",\"decision\":\"qa\"}))")"; G=$(curl -s "$B?category=Decision&limit=10"); echo "$G"; echo "$G" | jq -e ".data == []"'
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
{"success":true,"data":[],"total":0}
true
```

### T-3
对应: Q-3
verdict: PASS
说明：不带 category 和 `"category":""` 两条都返回 201，data.category 为 general，topic 与传入一致；GET ?category=general&limit=200 按 topic 各找到 1 条。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; TS=$(date +%s%N); post() { R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "$1"); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed "\$d"); echo "$CODE $BODY"; [ "$CODE" = "201" ] || exit 1; echo "$BODY" | jq -e --arg t "$2" ".success == true and .data.category == \"general\" and .data.topic == \$t" >/dev/null || exit 1; }; post "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}" "qa-nocat-$TS"; post "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}" "qa-emptycat-$TS"; G=$(curl -s "$B?category=general&limit=200"); echo "$G" | jq -c --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" "[.data[] | select(.topic == \$a or .topic == \$b) | {id,topic,category}]"; echo "$G" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" "([.data[] | select(.topic == \$a and .category == \"general\")] | length == 1) and ([.data[] | select(.topic == \$b and .category == \"general\")] | length == 1)"'
```
```output
201 {"success":true,"data":{"id":"19cca0a5-0342-4088-b7b6-5c37935e6c26","category":"general","topic":"qa-nocat-1791666723091167000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T16:12:03.097Z"}}
201 {"success":true,"data":{"id":"aaa0a193-d1af-4868-951e-0e9f3c596ff1","category":"general","topic":"qa-emptycat-1791666723091167000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T16:12:03.114Z"}}
[{"id":"aaa0a193-d1af-4868-951e-0e9f3c596ff1","topic":"qa-emptycat-1791666723091167000","category":"general"},{"id":"19cca0a5-0342-4088-b7b6-5c37935e6c26","topic":"qa-nocat-1791666723091167000","category":"general"}]
true
```

### T-4
对应: Q-4
verdict: PASS
说明：category=decision 写入返回 201，id 非空；GET ?category=decision&limit=200 按这个 id 找到 1 条，topic、category 都对得上。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; TS=$(date +%s%N); T="qa-decision-$TS"; R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"qa 合法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed "\$d"); [ "$CODE" = "201" ] || exit 1; ID=$(echo "$BODY" | jq -er "select(.data.category == \"decision\") | .data.id | select(. != null and . != \"\")"); G=$(curl -s "$B?category=decision&limit=200"); echo "$G" | jq -c --arg id "$ID" "[.data[] | select(.id == \$id) | {id,topic,category}]"; echo "$G" | jq -e --arg id "$ID" --arg t "$T" "[.data[] | select(.id == \$id and .topic == \$t and .category == \"decision\")] | length == 1"'
```
```output
{"success":true,"data":{"id":"e36af4e7-c651-4743-aea6-43f5b3a4c505","category":"decision","topic":"qa-decision-1791666730366826000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T16:12:10.373Z"}}
201
[{"id":"e36af4e7-c651-4743-aea6-43f5b3a4c505","topic":"qa-decision-1791666730366826000","category":"decision"}]
true
```

### T-5
对应: Q-5
verdict: PASS
说明：用 coding-workflow 判定点的真实 shape（judgment / made_by=system / author=coding-workflow / source_ref）写入返回 201；GET ?category=judgment&limit=1000 按 topic 找到 1 条，category 为 judgment。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; TS=$(date +%s%N); T="判定点[qa$TS#1]: qa"; R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "{\"category\":\"judgment\",\"topic\":\"$T\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); [ "$CODE" = "201" ] || exit 1; G=$(curl -s "$B?category=judgment&limit=1000"); echo "$G" | jq -c --arg t "$T" "[.data[] | select(.topic == \$t) | {id,topic,category,made_by,author}]"; echo "$G" | jq -e --arg t "$T" "[.data[] | select(.topic == \$t and .category == \"judgment\")] | length == 1"'
```
```output
{"success":true,"data":{"id":"31f7c5fc-2c61-4100-9dd4-afe1a3c00369","category":"judgment","topic":"判定点[qa1791666734844928000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-10T16:12:14.850Z"}}
201
[{"id":"31f7c5fc-2c61-4100-9dd4-afe1a3c00369","topic":"判定点[qa1791666734844928000#1]: qa","category":"judgment","made_by":"system","author":"coding-workflow"}]
true
```

### X-1
对应: I-1, I-2
verdict: PASS
场景：用户传前面带空格的 `" decision"`、数组 `["decision"]`、对象 `{}`、布尔 `true`，都返回 400 并带 allowed_categories；传 `null` 按不带 category 处理，201 写成 general；GET 查 `" decision"` 和 `true` 都没有写入。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; TS=$(date +%s%N); for c in "\" decision\"" "[\"decision\"]" "{}" "true"; do R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "{\"category\":$c,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); CODE=$(echo "$R" | tail -n1); echo "$c -> $CODE"; [ "$CODE" = "400" ] || exit 1; echo "$R" | sed "\$d" | jq -e ".allowed_categories | length > 0" >/dev/null || exit 1; done; R=$(curl -s -w "\n%{http_code}" -X POST $B -H "Content-Type: application/json" -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "null -> $(echo "$R" | tail -n1) $(echo "$R" | sed "\$d" | jq -c "{category:.data.category,topic:.data.topic}")"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; echo "$R" | sed "\$d" | jq -e ".data.category == \"general\"" >/dev/null; curl -s "$B?category=%20decision&limit=10" | jq -e ".data == []"; curl -s "$B?category=true&limit=10" | jq -e ".data == []"'
```
```output
" decision" -> 400
["decision"] -> 400
{} -> 400
true -> 400
null -> 201 {"category":"general","topic":"qa-null-1791666756521752000"}
true
true
```

### X-2
对应: I-1
verdict: PASS
场景：10 个非法 category 请求并发发出，10 个都是 400，响应都带非空 allowed_categories，没有写入任何行。
```command
bash -c 'set -e; B=http://localhost:5305/api/brain/strategic-decisions; TS=$(date +%s%N); C="bogus_conc_$TS"; for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o "/tmp/qa-r9-body-$TS-$i" -w "%{http_code}\n" -X POST $B -H "Content-Type: application/json" -d "{\"category\":\"$C\",\"topic\":\"qa-conc-$TS-$i\",\"decision\":\"qa\"}" > "/tmp/qa-r9-conc-$TS-$i" & done; wait; cat /tmp/qa-r9-conc-$TS-* | sort | uniq -c; N=$(cat /tmp/qa-r9-conc-$TS-* | grep -c "^400$"); [ "$N" = "10" ] || exit 1; cat /tmp/qa-r9-body-$TS-* | jq -s -e "all(.allowed_categories | length > 0)"; curl -s "$B?category=$C&limit=10" | jq -e ".data == []"'
```
```output
  10 400
true
true
```

### X-3
对应: I-1
严重度: 建议
场景：调用方发了一个坏 JSON（`{bad`），接口返回 HTTP 500，error 是 JSON 解析器的英文原文。这是调用方的输入错，应该是 400。本 PR 只改了 `strategic-decisions.js` 的 POST 处理函数，JSON 解析在它之前的全局中间件里，应该是原来就有的问题，不在本需求范围（本轮没起 main 基线对比，只看了 PR 改动的文件清单）。建议另立任务。
verdict: FAIL
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6232-9 && git diff --stat origin/main...HEAD -- packages/brain | tail -5; bash -c 'R=$(curl -s -w "\n%{http_code}" -X POST http://localhost:5305/api/brain/strategic-decisions -H "Content-Type: application/json" --data-binary "{bad"); echo "$R"'
```
```output
 .../smoke/strategic-decisions-category-smoke.sh    |  62 +++++
 .../src/__tests__/cw-bd2b1556-qa-smoke.test.js     |  81 +++++++
 .../__tests__/strategic-decisions-category.test.js | 255 +++++++++++++++++++++
 packages/brain/src/routes/strategic-decisions.js   | 111 +++++++++
 6 files changed, 587 insertions(+)
2026-10-10 14:12:52.765 curl[78924:101056668] CFPropertyListCreateFromXMLData(): Old-style plist parser: missing semicolon or value in dictionary on line 1. Parsing will be abandoned. Break on _CFPropertyListMissingSemicolonOrValue to debug.
2026-10-10 14:12:52.766 curl[78924:101056668] CFPropertyListCreateFromXMLData(): Old-style plist parser: missing semicolon or value in dictionary on line 1. Parsing will be abandoned. Break on _CFPropertyListMissingSemicolonOrValue to debug.
{"success":false,"error":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}
500
```
