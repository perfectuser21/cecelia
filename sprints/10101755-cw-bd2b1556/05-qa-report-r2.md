---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 2 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T11:43:19Z。所有 topic 带本轮纳秒时间戳，断言只查本轮返回的 id/topic。全程只访问 PREVIEW_URL，没有访问生产。

### T-1
对应: Q-1
verdict: PASS
说明：非法 category 返回 400，error 以「category 非法，合法值：」开头，allowed_categories 含 decision/judgment/general，响应体不含约束名或 SQL 原文；GET ?category=workflow_bogus 返回空数组，没有写入。
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | type == "array" and length > 0 and index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | jq -e '.data == []' && echo Q1_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
true
Q1_OK
```

### T-2
对应: Q-2
verdict: PASS
说明：边界①数字 category=123 原样连发 3 次，每次都是 400、带 allowed_categories、无 SQL 原文，结果一致。
```command
TS=$(date +%s%N); for i in 1 2 3; do R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":123,\"topic\":\"qa-num-$TS-$i\",\"decision\":\"qa 数字 category\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "400" || exit 1; echo "$R" | sed '$d' | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null || exit 1; ! echo "$R" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' || exit 1; done; echo Q2_NUM_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
Q2_NUM_OK
```

### T-3
对应: Q-2
verdict: PASS
说明：边界②大小写变体 "Decision" 返回 400，无 SQL 原文；GET ?category=Decision 返回空数组。
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa 大小写变体\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "400" && echo "$R" | sed '$d' | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' && ! echo "$R" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=Decision&limit=10' | jq -e '.data == []' && echo Q2_CASE_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
true
Q2_CASE_OK
```

### T-4
对应: Q-2
verdict: PASS
说明：边界③5000 个 a 的 category（python3 生成 body）返回 400，不是 500，没有 varchar 长度错误或 SQL 原文。
```command
TS=$(date +%s%N); BODY=$(python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-'+sys.argv[1],'decision':'qa 超长 category'}))" "$TS"); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$R" | cut -c1-200; test "$(echo "$R" | tail -n1)" = "400" && echo "$R" | sed '$d' | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' && ! echo "$R" | grep -iqE 'decisions_category_chk|check constraint|violates|relation|too long' && echo Q2_LONG_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
true
Q2_LONG_OK
```

### T-5
对应: Q-3
verdict: PASS
说明：不带 category 与 category="" 两条都返回 201，data.category=general，topic 与传入一致；GET ?category=general&limit=200 按 topic 能找到这两条。
```command
TS=$(date +%s%N); T1="qa-nocat-$TS"; T2="qa-emptycat-$TS"; R1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"topic\":\"$T1\",\"decision\":\"qa 不带 category\"}"); echo "$R1"; R2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"$T2\",\"decision\":\"qa 空 category\"}"); echo "$R2"; test "$(echo "$R1" | tail -n1)" = "201" && test "$(echo "$R2" | tail -n1)" = "201" && echo "$R1" | sed '$d' | jq -e --arg t "$T1" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "$T2" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=general&limit=200' | jq -e --arg a "$T1" --arg b "$T2" '([.data[] | select(.topic == $a or .topic == $b)] | length) == 2' && echo Q3_OK
```
```output
{"success":true,"data":{"id":"ebace0c1-163a-42e2-91aa-4fc6e6bc09fe","category":"general","topic":"qa-nocat-1791632618634457000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:43:38.642Z"}}
201
{"success":true,"data":{"id":"14fdeca6-27ad-4a22-ae8c-36e6bd334476","category":"general","topic":"qa-emptycat-1791632618634457000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:43:38.651Z"}}
201
true
true
true
Q3_OK
```

### T-6
对应: Q-4
verdict: PASS
说明：category=decision 返回 201，data.id 非空；GET ?category=decision&limit=200 里恰有一条 id、topic 都匹配且 category=decision 的记录。
```command
TS=$(date +%s%N); T="qa-decision-$TS"; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"qa 合法 category\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "201" && ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id') && test -n "$ID" && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=decision&limit=200' | jq -e --arg id "$ID" --arg t "$T" '[.data[] | select((.id|tostring) == $id and .topic == $t and .category == "decision")] | length == 1' && echo Q4_OK
```
```output
{"success":true,"data":{"id":"78e483b2-0886-4430-a261-b0e444b8d202","category":"decision","topic":"qa-decision-1791632621274476000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:43:41.281Z"}}
201
true
Q4_OK
```

### T-7
对应: Q-5
verdict: PASS
说明：按 coding-workflow 判定点真实 shape（judgment + made_by=ai + author + source_ref）POST 返回 201；GET ?category=judgment&limit=1000 按 topic 找到，category=judgment。原调用方未被新校验误伤。
```command
TS=$(date +%s%N); T="判定点[qa$TS#1]: qa"; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"$T\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "201" && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -e --arg t "$T" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1' && echo Q5_OK
```
```output
{"success":true,"data":{"id":"abaae28a-ed5d-49a2-bcdb-8454fd2bb319","category":"judgment","topic":"判定点[qa1791632623800918000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-10T06:43:43.807Z"}}
201
true
Q5_OK
```

### X-1
对应: Q-2, I-1, I-2
verdict: PASS
场景：用户传各种非字符串/变形 category。null 按「不带 category」处理写成 general 返回 201（符合 I-2）；数组、对象、布尔、前导空格 " decision" 全部 400 并给出合法值，没有 500。
```command
TS=$(date +%s%N); for C in 'null' '["decision"]' '{}' 'true' '" decision"'; do R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa 探索\"}"); echo "category=$C -> $(echo "$R" | tail -n1) $(echo "$R" | sed '$d' | cut -c1-90)"; done
```
```output
category=null -> 201 {"success":true,"data":{"id":"9514dbe1-01f0-4745-9300-b98c5014a886","category":"general","
category=["decision"] -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature
category={} -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature
category=true -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature
category=" decision" -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature
```

### X-2
对应: I-1
verdict: PASS
场景：调用方连续快速并发 10 个非法 category 请求。10 个全部 400，没有 500，GET ?category=workflow_bogus 仍为空数组，无副作用写入。
```command
TS=$(date +%s%N); for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS-$i\",\"decision\":\"qa 并发\"}" & done; wait; curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | jq -c '.data'
```
```output
400
400
400
400
400
400
400
400
400
400
[]
```

### X-3
对应: I-1
verdict: PASS
场景：用户发空 body、或只带非法 category 不带必填字段。返回 400 且中文提示「topic 和 decision 为必填项」，说人话，没有 500。
```command
curl -s -w '\n%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{}'; curl -s -w '\n%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus"}'
```
```output
{"success":false,"error":"topic 和 decision 为必填项"}
400
{"success":false,"error":"topic 和 decision 为必填项"}
400
```

## 小结

| 项 | 结果 |
|---|---|
| Q-1 非法 category → 400 + 合法值、不透 SQL、不写库 | PASS |
| Q-2 数字/大小写/超长、重复发送 | PASS |
| Q-3 不带 / 空 category → 201 general | PASS |
| Q-4 合法 decision → 201 且 GET 可查 | PASS |
| Q-5 coding-workflow judgment shape → 201 | PASS |
| 探索（null/数组/对象/布尔/空格、并发、空 body） | 无问题 |

备注（不影响判定）：本轮全部是接口场景，没有打开浏览器，所以没有截图。预览库约束是 14 个值（13 + general），说明 544 迁移已在预览库生效。
