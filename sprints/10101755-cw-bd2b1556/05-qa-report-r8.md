---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 8 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T20:36:22Z。所有条目只访问预览环境，每条命令自造带时间戳的 topic / category，不依赖库内已有数据。本需求纯接口层，未使用浏览器，无截图。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s)$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10'); echo "$G"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && echo "$G" | jq -e '.data == []'
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
{"success":true,"data":[],"total":0}
true
true
```

### T-2
对应: Q-2
verdict: PASS
```command
TS=$(date +%s)$RANDOM; post() { curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$1"; }; chk() { R="$1"; echo "$R" | cut -c1-200; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation'; }; B1="{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}"; chk "$(post "$B1")" || exit 1; chk "$(post "$B1")" || exit 1; chk "$(post "$B1")" || exit 1; chk "$(post "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}")" || exit 1; B3=$(python3 -c "import json;print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))"); chk "$(post "$B3")" || exit 1; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=Decision&limit=10'); echo "$G"; echo "$G" | jq -e '.data == []'
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["archit
400
{"success":true,"data":[],"total":0}
true
```
说明：前 3 条为 `category:123` 连发 3 次，第 4 条为 `"Decision"`，第 5 条为 5000 个 `a`；全部 400、无 500、结果一致。

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s)$RANDOM; R1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); echo "$R1"; R2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R2"; [ "$(echo "$R1" | tail -n1)" = "201" ] && [ "$(echo "$R2" | tail -n1)" = "201" ] && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=general&limit=200' | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '([.data[] | select(.topic == $a or .topic == $b)] | length) == 2'
```
```output
{"success":true,"data":{"id":"6fc248a7-c690-4288-a9b6-33b84693146e","category":"general","topic":"qa-nocat-179166460510937","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T15:36:45.604Z"}}
201
{"success":true,"data":{"id":"9e565e2d-34d7-4453-81cf-19e4bbbefb51","category":"general","topic":"qa-emptycat-179166460510937","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T15:36:45.614Z"}}
201
true
true
true
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s)$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id | select(. != null and . != "")') || exit 1; curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=decision&limit=200' | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id == $id and .topic == $t and .category == "decision")] | length == 1'
```
```output
{"success":true,"data":{"id":"1f9420f9-7c1b-457d-8859-29ae694d6cb5","category":"decision","topic":"qa-decision-17916646106251","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T15:36:50.865Z"}}
201
true
```

### T-5
对应: Q-5
verdict: PASS
```command
TS=$(date +%s)$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -e --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1'
```
```output
{"success":true,"data":{"id":"d7b6bb35-a037-4db2-9580-a5d86b39dd51","category":"judgment","topic":"判定点[qa17916646154876#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-10T15:36:55.381Z"}}
201
true
```

### X-1
对应: I-1, I-2
场景: 非字符串类型（数组、对象、布尔）和带前导空格的 category 一律 400 并给出合法值；`null` 按「不带 category」处理写入 general 返回 201，符合规格
verdict: PASS
```command
TS=$(date +%s)$RANDOM; for C in '["decision"]' '{}' 'true' '" decision"' 'null'; do echo "== category=$C"; curl -s -w '\n%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x1-$TS\",\"decision\":\"qa\"}" | cut -c1-160; done
```
```output
== category=["decision"]
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400
== category={}
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400
== category=true
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400
== category=" decision"
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400
== category=null
{"success":true,"data":{"id":"2080031e-1f4c-4484-9cbd-708026e41968","category":"general","topic":"qa-x1-179166461920687","decision":"qa","reason":null,"status":
201
```

### X-2
对应: I-1
场景: 10 个同一非法 category 的请求并发发出，全部 400，事后按该 category 查询没有任何写入
verdict: PASS
```command
TS=$(date +%s)$RANDOM; for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"qa_conc_$TS\",\"topic\":\"qa-conc-$TS-$i\",\"decision\":\"qa\"}" & done | sort | uniq -c; wait; curl -s "http://localhost:5305/api/brain/strategic-decisions?category=qa_conc_$TS&limit=10"
```
```output
  10 400
{"success":true,"data":[],"total":0}
```

### X-3
对应: I-1
严重度: 建议
场景: 调用方发出语法残缺的 JSON body 时，接口返回 HTTP 500，error 透出 JSON 解析器原文（"Expected double-quoted property name…"），而不是 400 的人话提示；缺 topic 时则正确返回 400「topic 和 decision 为必填项」。坏 JSON 走的是全局 body 解析，属本需求范围外的存量问题，不影响 I-1~I-3 验收，建议另立任务统一处理
verdict: FAIL
```command
curl -s -w '\n%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus"}'; curl -s -w '\n%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"decision",'
```
```output
{"success":false,"error":"topic 和 decision 为必填项"}
400
{"success":false,"error":"Expected double-quoted property name in JSON at position 23 (line 1 column 24)"}
500
```
