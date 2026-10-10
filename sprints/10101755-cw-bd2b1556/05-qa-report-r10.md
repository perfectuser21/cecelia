---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 10 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T22:54:45Z（本机 UTC）。所有断言只认本轮带时间戳的 topic 或本轮返回的 id。本轮没有页面类场景，没开浏览器，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5305; TS=$(date +%s)$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; BODY=$(echo "$R" | sed '$d'); CODE=$(echo "$R" | tail -n1); G=$(curl -s "$B/api/brain/strategic-decisions?category=workflow_bogus&limit=10"); echo "GET: $G"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && echo "$G" | jq -e '.data == []'
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
GET: {"success":true,"data":[],"total":0}
true
true
```

### T-2
对应: Q-2
verdict: PASS
```command
B=http://localhost:5305; TS=$(date +%s)$RANDOM; FAIL=0; chk() { R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' --data-binary @-); BODY=$(echo "$R" | sed '$d'); CODE=$(echo "$R" | tail -n1); echo "$1 -> $CODE $(echo "$BODY" | cut -c1-120)"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' || FAIL=1; }; for i in 1 2 3; do echo "{\"category\":123,\"topic\":\"qa-num-$TS-$i\",\"decision\":\"qa\"}" | chk "num#$i"; done; echo "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" | chk case; python3 -c "import json;print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))" | chk long5000; G=$(curl -s "$B/api/brain/strategic-decisions?category=Decision&limit=10"); echo "GET Decision: $G"; echo "$G" | jq -e '.data == []' >/dev/null || FAIL=1; echo FAIL=$FAIL; [ $FAIL -eq 0 ]
```
```output
num#1 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
num#2 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
num#3 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
case -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
long5000 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
GET Decision: {"success":true,"data":[],"total":0}
FAIL=0
```

### T-3
对应: Q-3
verdict: PASS
```command
B=http://localhost:5305; T1=qa-nocat-$(date +%s)$RANDOM; T2=qa-emptycat-$(date +%s)$RANDOM; R1=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"topic\":\"$T1\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"$T2\",\"decision\":\"qa 空 category\"}"); echo "$R1"; echo "$R2"; G=$(curl -s "$B/api/brain/strategic-decisions?category=general&limit=200"); echo "$G" | jq -c --arg a "$T1" --arg b "$T2" '[.data[] | select(.topic == $a or .topic == $b) | {id,topic,category}]'; [ "$(echo "$R1" | tail -n1)" = "201" ] && [ "$(echo "$R2" | tail -n1)" = "201" ] && echo "$R1" | sed '$d' | jq -e --arg t "$T1" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "$T2" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$G" | jq -e --arg a "$T1" --arg b "$T2" '([.data[] | select(.topic == $a)] | length == 1) and ([.data[] | select(.topic == $b)] | length == 1)'
```
```output
{"success":true,"data":{"id":"42a21129-e343-48c3-9d51-bf3443883af0","category":"general","topic":"qa-nocat-17916729078549","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T17:55:07.702Z"}}
201
{"success":true,"data":{"id":"f5f809c0-1b5b-4d9d-9548-70467fcecaef","category":"general","topic":"qa-emptycat-17916729077236","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T17:55:07.714Z"}}
201
[{"id":"f5f809c0-1b5b-4d9d-9548-70467fcecaef","topic":"qa-emptycat-17916729077236","category":"general"},{"id":"42a21129-e343-48c3-9d51-bf3443883af0","topic":"qa-nocat-17916729078549","category":"general"}]
true
true
true
```

### T-4
对应: Q-4
verdict: PASS
```command
B=http://localhost:5305; T=qa-decision-$(date +%s)$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"qa 合法 category\"}"); echo "$R"; ID=$(echo "$R" | sed '$d' | jq -r '.data.id'); G=$(curl -s "$B/api/brain/strategic-decisions?category=decision&limit=200"); echo "$G" | jq -c --arg id "$ID" '[.data[] | select(.id == $id) | {id,topic,category}]'; [ "$(echo "$R" | tail -n1)" = "201" ] && echo "$R" | sed '$d' | jq -e '.data.category == "decision" and (.data.id | length > 0)' && echo "$G" | jq -e --arg id "$ID" --arg t "$T" '[.data[] | select(.id == $id and .topic == $t and .category == "decision")] | length == 1'
```
```output
{"success":true,"data":{"id":"fc14972b-55a3-4f32-ac0c-9079227e6553","category":"decision","topic":"qa-decision-179167291116568","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T17:55:11.821Z"}}
201
[{"id":"fc14972b-55a3-4f32-ac0c-9079227e6553","topic":"qa-decision-179167291116568","category":"decision"}]
true
true
```

### T-5
对应: Q-5
verdict: PASS
```command
B=http://localhost:5305; TS=$(date +%s)$RANDOM; T="判定点[qa$TS#1]: qa"; BODY=$(jq -nc --arg t "$T" --arg s "coding-workflow:qa-$TS" '{category:"judgment",topic:$t,decision:"所选方法: x｜候选: y",reason:"依据: z",made_by:"system",author:"coding-workflow",source_ref:$s}'); R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "$BODY"); echo "$R"; G=$(curl -s "$B/api/brain/strategic-decisions?category=judgment&limit=1000"); echo "$G" | jq -c --arg t "$T" '[.data[] | select(.topic == $t) | {id,topic,category,made_by}]'; [ "$(echo "$R" | tail -n1)" = "201" ] && echo "$G" | jq -e --arg t "$T" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1'
```
```output
{"success":true,"data":{"id":"43104930-1511-4a7f-833f-dee1018bc0da","category":"judgment","topic":"判定点[qa179167291410785#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-10T17:55:14.750Z"}}
201
[{"id":"43104930-1511-4a7f-833f-dee1018bc0da","topic":"判定点[qa179167291410785#1]: qa","category":"judgment","made_by":"system"}]
true
```

### X-1
对应: Q-2, I-1, I-2
场景: 前后带空格的值、数组、对象、布尔都应该返回 400，`null` 应该按不带 category 处理并写成 general；被拒的请求不能写入任何行
verdict: PASS
```command
B=http://localhost:5305; TS=$(date +%s)$RANDOM; FAIL=0; for C in '" decision"' '["decision"]' '{}' 'true'; do R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); CODE=$(echo "$R" | tail -n1); echo "$C -> $CODE $(echo "$R" | sed '$d' | jq -c '{success,n:(.allowed_categories|length)}')"; [ "$CODE" = "400" ] || FAIL=1; done; R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "null -> $(echo "$R" | tail -n1) $(echo "$R" | sed '$d' | jq -c '.data.category')"; [ "$(echo "$R" | tail -n1)" = "201" ] || FAIL=1; G=$(curl -s "$B/api/brain/strategic-decisions?limit=1000"); echo "$G" | jq -e --arg t "qa-x-$TS" '[.data[] | select(.topic == $t)] | length == 0' || FAIL=1; echo FAIL=$FAIL; [ $FAIL -eq 0 ]
```
```output
" decision" -> 400 {"success":false,"n":14}
["decision"] -> 400 {"success":false,"n":14}
{} -> 400 {"success":false,"n":14}
true -> 400 {"success":false,"n":14}
null -> 201 "general"
true
FAIL=0
```

### X-2
对应: Q-2, I-1
场景: 同一个非法 category 请求并发打 10 次，应该次次都是 400 且不写入；空 body 应该得到人能看懂的必填提示
verdict: PASS
```command
B=http://localhost:5305; TS=$(date +%s)$RANDOM; for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS\",\"decision\":\"qa\"}" & done | sort | uniq -c; wait; echo "--- 非法JSON"; curl -s -w '\n%{http_code}\n' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d '{"category":'; echo "--- 空 body"; curl -s -w '\n%{http_code}\n' -X POST "$B/api/brain/strategic-decisions" -H 'Content-Type: application/json' -d '{}'
```
```output
  10 400
--- 非法JSON
{"success":false,"error":"Unexpected end of JSON input"}
500
--- 空 body
{"success":false,"error":"topic 和 decision 为必填项"}
400
```
并发之后再查一次，确认没有写入：
```command
curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=1000' | jq -e '.data | length == 0'
```
```output
true
```

### X-3
对应: I-1
严重度: 建议
场景: 调用方发来截断的 JSON（`{"category":`），收到 HTTP 500 和「Unexpected end of JSON input」。这是请求格式错，应该返回 4xx 并给出说明。这个错误发生在 JSON 解析层，和 category 校验无关，很可能是改动前就有的问题（本轮没建 main 基线，未证实）。不在本需求范围，建议另立任务
verdict: FAIL
```command
curl -s -w '\n%{http_code}\n' -X POST 'http://localhost:5305/api/brain/strategic-decisions' -H 'Content-Type: application/json' -d '{"category":'
```
```output
{"success":false,"error":"Unexpected end of JSON input"}
500
```

## 结论

| 场景 | 结果 |
|---|---|
| Q-1 非法 category → 400 + 允许值列表，没有 SQL 原文，也没有写库 | PASS |
| Q-2 数字、大小写变体、5000 字符、重复 3 次 → 都是 400 | PASS |
| Q-3 不带 category 或 `""` → 201，category 为 general，GET 能查到 | PASS |
| Q-4 category=decision → 201，按 id 能查回 | PASS |
| Q-5 coding-workflow 判定点 shape（judgment）→ 201，能查回 | PASS |
| 探索：空格、数组、对象、布尔、null、并发 10 次 | PASS |
| 探索：截断的 JSON 返回 500 | FAIL（建议级，在需求范围外） |
