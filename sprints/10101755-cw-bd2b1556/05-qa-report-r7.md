---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 7 轮，环境 http://localhost:5305）

本轮开始时间 2026-10-10T19:20:14Z（本机时钟）。所有断言只针对本轮自己造的 topic / id，不依赖预览库已有数据。本轮全部是接口层场景，没有用浏览器，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10'); echo "$G"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0 and index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && echo "$G" | jq -e '.data == []'
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
说明：`category:123` 原样连发 3 次（前 3 行），之后依次是 `"Decision"` 和 5000 个 `a`。5 次都返回 400，响应一致，都带 `allowed_categories`，也都不含约束名或 SQL 原文；GET `?category=Decision` 查到的 data 为空。
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; FAIL=0; chk(){ CODE=$(echo "$1" | tail -n1); BODY=$(echo "$1" | sed '$d'); echo "$CODE $(echo "$BODY" | cut -c1-120)"; [ "$CODE" = "400" ] || FAIL=1; echo "$BODY" | jq -e '.allowed_categories | type == "array" and length > 0' >/dev/null || FAIL=1; echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && FAIL=1; }; for i in 1 2 3; do chk "$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa 数字 category\"}")"; done; chk "$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa 大小写\"}")"; chk "$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "$(python3 -c "import json;print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa 超长'}))")")"; G=$(curl -s "$U?category=Decision&limit=10"); echo "$G"; echo "$G" | jq -e '.data == []' && [ $FAIL = 0 ]
```
```output
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
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; R1=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS-a\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-nocat-$TS-b\",\"decision\":\"qa 空 category\"}"); echo "$R1"; echo "$R2"; G=$(curl -s "$U?category=general&limit=200"); echo "$G" | jq -c --arg a "qa-nocat-$TS-a" --arg b "qa-nocat-$TS-b" '[.data[] | select(.topic==$a or .topic==$b) | {id,topic,category}]'; [ "$(echo "$R1" | tail -n1)" = 201 ] && [ "$(echo "$R2" | tail -n1)" = 201 ] && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS-a" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-nocat-$TS-b" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$G" | jq -e --arg a "qa-nocat-$TS-a" --arg b "qa-nocat-$TS-b" '([.data[] | select(.topic==$a)] | length == 1) and ([.data[] | select(.topic==$b)] | length == 1)'
```
```output
{"success":true,"data":{"id":"878144ed-c732-437a-ac59-452ba1d8df88","category":"general","topic":"qa-nocat-1791660033-a","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T14:20:33.527Z"}}
201
{"success":true,"data":{"id":"3d176464-ccb1-4c73-9198-812942bcc31f","category":"general","topic":"qa-nocat-1791660033-b","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T14:20:33.537Z"}}
201
[{"id":"3d176464-ccb1-4c73-9198-812942bcc31f","topic":"qa-nocat-1791660033-b","category":"general"},{"id":"878144ed-c732-437a-ac59-452ba1d8df88","topic":"qa-nocat-1791660033-a","category":"general"}]
true
true
true
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; ID=$(echo "$R" | sed '$d' | jq -r '.data.id'); G=$(curl -s "$U?category=decision&limit=200"); echo "$G" | jq -c --arg id "$ID" '[.data[] | select(.id==$id) | {id,topic,category}]'; [ "$(echo "$R" | tail -n1)" = 201 ] && echo "$R" | sed '$d' | jq -e '.data.category == "decision" and (.data.id | type == "string" and length > 0)' && echo "$G" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id==$id and .topic==$t and .category=="decision")] | length == 1'
```
```output
{"success":true,"data":{"id":"29a4095d-d74e-488a-93b3-37ce9b2d7550","category":"decision","topic":"qa-decision-1791660037","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T14:20:37.860Z"}}
201
[{"id":"29a4095d-d74e-488a-93b3-37ce9b2d7550","topic":"qa-decision-1791660037","category":"decision"}]
true
true
```

### T-5
对应: Q-5
verdict: PASS
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; G=$(curl -s "$U?category=judgment&limit=1000"); echo "$G" | jq -c --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic==$t) | {id,topic,category,made_by,author}]'; [ "$(echo "$R" | tail -n1)" = 201 ] && echo "$G" | jq -e --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic==$t and .category=="judgment")] | length == 1'
```
```output
{"success":true,"data":{"id":"289a2488-21ea-47d4-8c3d-d2a583876a7b","category":"judgment","topic":"判定点[qa1791660040#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-10T14:20:40.808Z"}}
201
[{"id":"289a2488-21ea-47d4-8c3d-d2a583876a7b","topic":"判定点[qa1791660040#1]: qa","category":"judgment","made_by":"system","author":"coding-workflow"}]
true
```

### X-1
对应: Q-2, I-1
verdict: PASS
场景: 测了其他非字符串类型（数组、对象、布尔）和首尾带空格的 decision，都返回 400 并带上 14 个合法值。`category:null` 按不带处理，默认写成 general；空 body 返回 400，并提示「topic 和 decision 为必填项」。
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; for C in '["decision"]' '{}' 'true' '" decision"' '"decision "'; do curl -s -o /tmp/qa7b.json -w "%{http_code} cat=$C " -X POST $U -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa 探索\"}"; jq -c '{success, n: (.allowed_categories|length)}' /tmp/qa7b.json; done; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa null\"}" | jq -c '.data.category? // .' 2>/dev/null; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{}'; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{"category":"bad"'; echo; curl -s "$U?topic=qa-x-$TS" | jq -c '.total'
```
```output
400 cat=["decision"] {"success":false,"n":14}
400 cat={} {"success":false,"n":14}
400 cat=true {"success":false,"n":14}
400 cat=" decision" {"success":false,"n":14}
400 cat="decision " {"success":false,"n":14}
"general"
{"success":false,"error":"topic 和 decision 为必填项"} 400
{"success":false,"error":"Expected ',' or '}' after property value in JSON at position 17 (line 1 column 18)"} 500

15
```

### X-2
对应: Q-2, I-1
verdict: PASS
场景: 同一个非法请求（workflow_bogus）同时并发发 10 次，10 次都返回 400，全库按 topic 查不到任何一行（全库 total=16，limit=1000 足以覆盖）。另外单独重发一次 `category:null`，返回 201，category 为 general。
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS\",\"decision\":\"qa 并发\"}" & done | sort | uniq -c; wait; R=$(curl -s -w '\n%{http_code}' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa null\"}"); echo "$R"; ALL=$(curl -s "$U?limit=1000"); echo "$ALL" | jq -c --arg t "qa-conc-$TS" '{total, conc_rows: [.data[] | select(.topic==$t)] | length}'; echo "$ALL" | jq -e --arg t "qa-conc-$TS" '[.data[] | select(.topic==$t)] | length == 0' && [ "$(echo "$R" | tail -n1)" = 201 ] && echo "$R" | sed '$d' | jq -e '.data.category == "general"'
```
```output
  10 400
{"success":true,"data":{"id":"037714cd-c06d-4173-b1af-61618e57e4ad","category":"general","topic":"qa-null-1791660056","decision":"qa null","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T14:20:56.591Z"}}
201
{"total":16,"conc_rows":0}
true
true
```

### X-3
对应: I-1
严重度: 建议
场景: 调用方发来的 body 不是合法 JSON（例如 `{"category":"bad"`，少了右括号），接口返回 HTTP 500，error 里是 JSON 解析器的原文「Expected ',' or '}' after property value in JSON at position 17」。这是调用方的输入错，按理应该返回 400；不过它和 category 校验无关，也没有透出数据库约束信息，属于需求范围外的存量问题（本轮没有建立 main 基线做对比），建议另立任务。
verdict: FAIL
```command
TS=$(date +%s); U=http://localhost:5305/api/brain/strategic-decisions; for C in '["decision"]' '{}' 'true' '" decision"' '"decision "'; do curl -s -o /tmp/qa7b.json -w "%{http_code} cat=$C " -X POST $U -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa 探索\"}"; jq -c '{success, n: (.allowed_categories|length)}' /tmp/qa7b.json; done; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa null\"}" | jq -c '.data.category? // .' 2>/dev/null; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{}'; curl -s -w ' %{http_code}\n' -X POST $U -H 'Content-Type: application/json' -d '{"category":"bad"'; echo; curl -s "$U?topic=qa-x-$TS" | jq -c '.total'
```
```output
{"success":false,"error":"Expected ',' or '}' after property value in JSON at position 17 (line 1 column 18)"} 500
```
