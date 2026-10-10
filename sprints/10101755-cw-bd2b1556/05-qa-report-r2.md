---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 2 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T13:56:19Z。所有数据都由本轮请求新造，topic 带纳秒时间戳，断言只按本轮返回的 id 或 topic 匹配，不依赖预览库已有数据。本需求只涉及接口，没有做页面操作，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | tee /dev/stderr | jq -e '.data == []' && echo Q1_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
{"success":true,"data":[],"total":0}true
Q1_OK
```
返回 400，提示说的是人话并列出了合法值，没有带出数据库约束名或 SQL 原文，也没有写入数据。

### T-2
对应: Q-2
verdict: PASS
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; check(){ R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' --data-binary @-); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); echo "$CODE ${BODY:0:160}"; test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation'; }; for i in 1 2 3; do echo "{\"category\":123,\"topic\":\"qa-num-$TS-$i\",\"decision\":\"qa\"}" | check || exit 1; done; echo "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" | check || exit 1; python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))" | check || exit 1; curl -s "$U?category=Decision&limit=10" | jq -e '.data == []' && echo Q2_OK
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
true
Q2_OK
```
测了数字 123（连发 3 次）、大小写变体 Decision、5000 字符长串，全部返回 400，没有 500；每条都带 allowed_categories，也都没有 SQL 原文。用 Decision 查回结果为空。

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R1=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); echo "$R1"; R2=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R2"; test "$(echo "$R1" | tail -n1)" = 201 && test "$(echo "$R2" | tail -n1)" = 201 && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s "$U?category=general&limit=200" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '([.data[] | select(.topic == $a or .topic == $b)] | length) == 2' && echo Q3_OK
```
```output
{"success":true,"data":{"id":"96c2c749-a8f3-435c-adcd-4e5004f56eda","category":"general","topic":"qa-nocat-1791640597105134000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T08:56:37.114Z"}}
201
{"success":true,"data":{"id":"33385b02-66b7-435e-b93a-37a21d8e4c5e","category":"general","topic":"qa-emptycat-1791640597105134000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T08:56:37.126Z"}}
201
true
true
true
Q3_OK
```
不带 category 和传空字符串都返回 201，默认写成 general，并且用 GET ?category=general 两条都能查到。

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 || exit 1; ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id | select(. != null and . != "")') || exit 1; curl -s "$U?category=decision&limit=200" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '.data | map(select(.id == $id)) | length == 1 and .[0].topic == $t and .[0].category == "decision"' && echo Q4_OK
```
```output
{"success":true,"data":{"id":"6615a219-8b71-43c5-83e8-f79558af2e12","category":"decision","topic":"qa-decision-1791640603612163000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T08:56:43.619Z"}}
201
true
Q4_OK
```
合法值 decision 返回 201，按返回的 id 查回，topic 和 category 都对得上。

### T-5
对应: Q-5
verdict: PASS
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 || exit 1; curl -s "$U?category=judgment&limit=1000" | jq -e --arg t "判定点[qa$TS#1]: qa" '.data | map(select(.topic == $t)) | length == 1 and .[0].category == "judgment"' && echo Q5_OK
```
```output
{"success":true,"data":{"id":"ce8d4149-50e9-4e67-96b5-0760cf64b9a3","category":"judgment","topic":"判定点[qa1791640607712279000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-10T08:56:47.719Z"}}
201
true
Q5_OK
```
按 coding-workflow 判定点的真实请求格式发送（made_by=ai），返回 201，能查回；新校验没有误伤原有调用方。

### X-1
对应: I-1, I-2
verdict: PASS
场景: 用户传非字符串类型（数组、对象、布尔）和前面带空格的 " decision"，应该返回 400；传 null 应当作没带 category 处理
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; for C in '["decision"]' '{}' 'true' '" decision"'; do R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); CODE=$(echo "$R" | tail -n1); echo "$C -> $CODE"; test "$CODE" = 400 && echo "$R" | sed '$d' | jq -e '.allowed_categories | length > 0' >/dev/null || exit 1; done; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 && echo "$R" | sed '$d' | jq -e '.data.category == "general"' && curl -s "$U?limit=1000" | jq -e --arg t "qa-x-$TS" '[.data[] | select(.topic == $t)] | length == 0' && echo X1_OK
```
```output
["decision"] -> 400
{} -> 400
true -> 400
" decision" -> 400
{"success":true,"data":{"id":"2d135f81-ec3d-486c-8b5a-0bfd94d3b74e","category":"general","topic":"qa-null-1791640614326269000","decision":"qa","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T08:56:54.396Z"}}
201
true
true
X1_OK
```

### X-2
对应: I-1
verdict: PASS
场景: 10 个非法 category 请求同时发出，每个都应返回 400，并且一条都不写库
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS\",\"decision\":\"qa\"}" & done | sort | uniq -c; wait; curl -s "$U?category=workflow_bogus&limit=10" | jq -e '.data == []' && echo X2_OK
```
```output
  10 400
true
X2_OK
```

### X-3
对应: I-1
严重度: 建议
场景: 调用方发了格式坏掉的 JSON body，接口返回 500，带的是 JSON 解析器的英文原文 "Unexpected end of JSON input"，而不是 400 加中文提示。这超出了本需求 I-1~I-3 的范围（category 校验），没有建立 main 基线来对比，不能确定是不是本次引入的；缺必填 topic 时返回 400 和中文提示，是正常的
verdict: FAIL
```command
U=http://localhost:5305/api/brain/strategic-decisions; echo '--- 缺 topic:'; curl -s -w '\n%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","decision":"qa"}'; echo '--- 坏 JSON:'; curl -s -w '\n%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{"category":'
```
```output
--- 缺 topic:
{"success":false,"error":"topic 和 decision 为必填项"}
400
--- 坏 JSON:
{"success":false,"error":"Unexpected end of JSON input"}
500
```
