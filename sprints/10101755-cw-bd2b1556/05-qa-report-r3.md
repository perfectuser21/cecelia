---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 3 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T16:23:11Z。所有请求只发往预览环境 http://localhost:5305，命令内自造数据（topic 带纳秒时间戳），断言失败即非零退出。

### T-1
对应: Q-1
verdict: PASS
说明：非法 category `workflow_bogus` → HTTP 400，`success=false`，`error` 以「category 非法，合法值：」开头，`allowed_categories` 含 decision/judgment/general，响应体无约束名/SQL 原文；随后 GET `?category=workflow_bogus` 的 data 为空。
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | type == "array" and length > 0 and index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | tee /dev/stderr | jq -e '.data == []' && echo ALL_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
{"success":true,"data":[],"total":0}true
ALL_OK
```

### T-2
对应: Q-2
verdict: PASS
说明：`category:123` 连发 3 次、`"Decision"`、5000 个 `a` 全部 400，每个响应带非空 `allowed_categories`、无 SQL 原文，重复结果一致；GET `?category=Decision` data 为空。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; check() { R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' --data-binary @-); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); echo "$CODE $(echo "$BODY" | cut -c1-120)"; test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation'; }; set -e; for i in 1 2 3; do echo "{\"category\":123,\"topic\":\"qa-num-$TS-$i\",\"decision\":\"qa 数字 category\"}" | check; done; echo "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa 大小写\"}" | check; python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa 超长'}))" | check; curl -s "$U?category=Decision&limit=10" | tee /dev/stderr | jq -e '.data == []'; echo ALL_OK
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
{"success":true,"data":[],"total":0}true
ALL_OK
```

### T-3
对应: Q-3
verdict: PASS
说明：不带 category 与 `category:""` 两条均 201，`data.category=general`，topic 一致；GET `?category=general&limit=200` 按 topic 找到两条。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R1=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R1"; echo "$R2"; test "$(echo "$R1" | tail -n1)" = 201 && test "$(echo "$R2" | tail -n1)" = 201 && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s "$U?category=general&limit=200" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '[.data[] | select(.topic == $a or .topic == $b) | .category] | length == 2 and all(. == "general")' && echo ALL_OK
```
```output
{"success":true,"data":{"id":"355ac3f1-b074-424b-8178-b69b12d83592","category":"general","topic":"qa-nocat-1791649405726595000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T11:23:25.733Z"}}
201
{"success":true,"data":{"id":"b121dcae-e0a3-486b-90ca-7064e263686f","category":"general","topic":"qa-emptycat-1791649405726595000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T11:23:25.744Z"}}
201
true
true
true
ALL_OK
```

### T-4
对应: Q-4
verdict: PASS
说明：`category:decision` → 201，`data.id` 非空；GET `?category=decision&limit=200` 有且仅有一条 id/topic/category 全匹配。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 && ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id | select(. != null and . != "")') && curl -s "$U?category=decision&limit=200" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id == $id and .topic == $t and .category == "decision")] | length == 1' && echo ALL_OK
```
```output
{"success":true,"data":{"id":"66c587ff-7390-4949-a028-83243b76e010","category":"decision","topic":"qa-decision-1791649409572512000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T11:23:29.579Z"}}
201
true
ALL_OK
```

### T-5
对应: Q-5
verdict: PASS
说明：按 coding-workflow spec-review 判定点真实 shape 写 `judgment` → 201；GET `?category=judgment&limit=1000` 按 topic 找到，category=judgment。原调用方未被误伤。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = 201 && curl -s "$U?category=judgment&limit=1000" | jq -e --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1' && echo ALL_OK
```
```output
{"success":true,"data":{"id":"157ab091-83d2-4a54-8650-827a4ac290d6","category":"judgment","topic":"判定点[qa1791649411996998000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-10T11:23:32.003Z"}}
201
true
ALL_OK
```

### X-1
对应: I-1
场景: 非字符串类型（数组 `["decision"]`、对象 `{}`、布尔 `true`）与前导空格 `" decision"` 作为 category 提交
verdict: PASS
说明：四种都返回 400 且带 14 个合法值；用这批请求的 topic 查全表无任何写入。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; for C in '["decision"]' '{}' 'true' '" decision"'; do curl -s -o /tmp/qa_x1.json -w "%{http_code} " -X POST $U -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x1-$TS\",\"decision\":\"x\"}"; jq -c '{success, allowed_n: (.allowed_categories|length)}' /tmp/qa_x1.json; done; curl -s "$U?limit=1000" | jq -e --arg t "qa-x1-$TS" '[.data[] | select(.topic == $t)] | length == 0' && echo NO_ROWS
```
```output
400 {"success":false,"allowed_n":14}
400 {"success":false,"allowed_n":14}
400 {"success":false,"allowed_n":14}
400 {"success":false,"allowed_n":14}
true
NO_ROWS
```

### X-2
对应: I-1, I-2
场景: 10 个非法 category 并发提交；`category:null`；空 body `{}`；JSON 被截断的畸形 body
verdict: FAIL
严重度: 建议
说明：并发 10 个非法请求全部 400（无 500、无竞态）；`null` 按不带 category 处理 → 201/general（符合 I-2）；空 body 返回人话提示「topic 和 decision 为必填项」400。唯一问题：畸形 JSON 返回 **HTTP 500** 且 error 为 JSON 解析器原文「Unexpected end of JSON input」——属于客户端输入错误却报服务端错误、且透出内部报错原文。这是 body 解析层（路由之外）的存量行为，不在本次 category 需求范围内，不影响 I-1~I-3，建议另立任务把 JSON 解析失败统一转 400。
```command
TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"bogus_$i\",\"topic\":\"qa-conc-$TS\",\"decision\":\"x\"}" & done | sort | uniq -c; wait; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"x\"}"); echo "$R"; R2=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d '{}'); echo "$R2"; R3=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d '{"category":'); echo "$R3" | tail -c 300
```
```output
  10 400
{"success":true,"data":{"id":"10666234-ca58-4ed3-a5a1-362a85db3cb9","category":"general","topic":"qa-null-1791649419017512000","decision":"x","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T11:23:39.056Z"}}
201
{"success":false,"error":"topic 和 decision 为必填项"}
400
{"success":false,"error":"Unexpected end of JSON input"}
500
```

## 小结

| 项 | 结果 |
|---|---|
| Q-1 非法 category → 400 + 合法值列表、无 SQL 原文、不写库 | PASS |
| Q-2 数字/大小写/超长/重复 → 全 400 | PASS |
| Q-3 不带 / 空 category → 201 general | PASS |
| Q-4 合法 decision → 201 且可查回 | PASS |
| Q-5 coding-workflow judgment 原调用方 → 201 | PASS |
| 探索：非字符串类型、并发、null、空 body | PASS |
| 探索：畸形 JSON → 500（存量、需求外） | FAIL·建议 |

备注：预览库约束含 14 个值（迁移 384 的 13 个 + `general`），与规格 S-2「只补 general」一致。本轮未使用浏览器（需求与 QA 场景均为接口层），无截图。
