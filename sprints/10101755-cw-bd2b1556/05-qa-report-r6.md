---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 6 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T18:47:08Z（本机 UTC）。所有断言只用本轮生成的 topic（`date +%s` 加 `$RANDOM`）或本轮 POST 返回的 id，不依赖预览库里的已有数据。本轮只调了接口，没有开浏览器，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10'); echo "GET: $G"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && echo "$G" | jq -e '.data == []'
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
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; check() { CODE=$(echo "$1" | tail -n1); BODY=$(echo "$1" | sed '$d'); echo "$CODE $BODY" | cut -c1-200; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation'; }; FIRST=""; for i in 1 2 3; do R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}"); check "$R" || exit 1; [ -z "$FIRST" ] && FIRST="$R"; [ "$R" = "$FIRST" ] || { echo "重复结果不一致"; exit 1; }; done; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}"); check "$R" || exit 1; B=$(python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))"); R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "$B"); check "$R" || exit 1; G=$(curl -s "$U?category=Decision&limit=10"); echo "GET: $G"; echo "$G" | jq -e '.data == []'
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["ar
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["ar
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["ar
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["ar
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["ar
GET: {"success":true,"data":[],"total":0}
true
```
说明：前 3 行是 `category:123` 连发 3 次，结果完全相同；第 4 行是 `"Decision"`；第 5 行是 5000 个 `a`。全部为 400，没有 500。

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; R1=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); echo "$R1"; R2=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 不带 category\"}"); echo "$R2"; [ "$(echo "$R1" | tail -n1)" = "201" ] && [ "$(echo "$R2" | tail -n1)" = "201" ] && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s "$U?category=general&limit=200" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '[.data[] | select(.topic == $a or .topic == $b)] | length == 2'
```
```output
{"success":true,"data":{"id":"6192d238-25f4-4acf-8c89-da4bc6aa13a6","category":"general","topic":"qa-nocat-1791658050-2461","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:47:30.377Z"}}
201
{"success":true,"data":{"id":"2cd130cb-3a69-43b2-b8c3-51d0d8e67b7a","category":"general","topic":"qa-emptycat-1791658050-2461","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:47:30.386Z"}}
201
true
true
true
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id // empty') || exit 1; curl -s "$U?category=decision&limit=200" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id == $id and .topic == $t and .category == "decision")] | length == 1'
```
```output
{"success":true,"data":{"id":"5569907e-0609-4eaf-b77d-a674c381f47b","category":"decision","topic":"qa-decision-1791658052-19693","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:47:32.864Z"}}
201
true
```

### T-5
对应: Q-5
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] && curl -s "$U?category=judgment&limit=1000" | jq -e --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1'
```
```output
{"success":true,"data":{"id":"83ab39b2-cfaf-4e00-83be-e10272db4619","category":"judgment","topic":"判定点[qa1791658055-9535#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-10T13:47:35.360Z"}}
201
true
```

### X-1
对应: I-1, I-2
场景: 其他非字符串类型（数组、对象、布尔）和前后带空格的变体都应返回 400；`category:null` 按「不带 category」处理，返回 201 并写入 general
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; for C in '["decision"]' '{}' 'true' '" decision"' '"decision "'; do R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); echo "category=$C -> $CODE $(echo "$BODY" | jq -c '{success,n:(.allowed_categories|length)}')"; [ "$CODE" = "400" ] && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' || exit 1; done; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "category=null -> $R"; [ "$(echo "$R" | tail -n1)" = "201" ] && echo "$R" | sed '$d' | jq -e '.data.category == "general"'
```
```output
category=["decision"] -> 400 {"success":false,"n":14}
category={} -> 400 {"success":false,"n":14}
category=true -> 400 {"success":false,"n":14}
category=" decision" -> 400 {"success":false,"n":14}
category="decision " -> 400 {"success":false,"n":14}
category=null -> {"success":true,"data":{"id":"af4587a2-0390-417b-acc5-5beefd7acbac","category":"general","topic":"qa-null-1791658061-30764","decision":"qa","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:47:41.741Z"}}
201
true
```

### X-2
对应: I-1
场景: 同一个非法请求并发发 10 次，每次都应返回 400，响应里没有 SQL 原文，也不写入任何行
verdict: PASS
```command
TS=$(date +%s)-$RANDOM; U=http://localhost:5305/api/brain/strategic-decisions; D=$(mktemp -d); for i in $(seq 1 10); do curl -s -o "$D/b$i" -w '%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS\",\"decision\":\"qa\"}" > "$D/c$i" & done; wait; cat $D/c*; echo; cat $D/c* | tr -d '\n' | grep -qx '\(400\)\{10\}' && ! cat $D/b* | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && curl -s "$U?category=workflow_bogus&limit=10" | jq -e '.data == []'
```
```output
400400400400400400400400400400
true
```

### X-3
对应: I-1
严重度: 建议
场景: 用户发了格式错误的 JSON body（`{bad json`），接口返回 HTTP 500，`error` 是 JSON 解析器的英文原文。这类请求属于调用方输入错误，应返回 400。空 body 和缺 category 的情况都正确返回 400 和中文提示。看报错文本，500 来自全局的 JSON body 解析，在路由处理函数之前就失败了，不是本次 category 校验引入的，也超出本需求的范围。本轮没有起 main 基线做对比，不能确认改动前是否相同。建议另立任务处理。
verdict: FAIL
```command
U=http://localhost:5305/api/brain/strategic-decisions; curl -s -w '\n%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{}'; curl -s -w '\n%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{"category":"workflow_bogus"}'; curl -s -w '\n%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{bad json'
```
```output
{"success":false,"error":"topic 和 decision 为必填项"}
400
{"success":false,"error":"topic 和 decision 为必填项"}
400
{"success":false,"error":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}
500
```
