---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 5 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T18:10:27Z。所有断言只认本轮用纳秒时间戳造出的 topic，或本轮 POST 返回的 id，不依赖预览库里已有的数据。本轮只验接口，没开浏览器（Q-1~Q-5 都是 API 场景）。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R" >&2; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10'); echo "GET: $G" >&2; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | length > 0) and (.allowed_categories | index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation' && echo "$G" | jq -e '.data == []'
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
说明：依次发 `category:123`（连发 3 次）、`"Decision"`、5000 个 `a`，每次都要求 400、带非空 `allowed_categories` 数组、不含 SQL 原文；最后 GET `?category=Decision` 为空。
```command
TS=$(date +%s%N); chk() { R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' --data-binary @-); CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed '$d'); echo "$CODE $(echo "$BODY" | cut -c1-160)" >&2; [ "$CODE" = "400" ] && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -iqE 'decisions_category_chk|check constraint|violates|relation'; }; for i in 1 2 3; do echo "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}" | chk || exit 1; done; echo "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" | chk || exit 1; python3 -c "import json;print(json.dumps({'category':'a'*5000,'topic':'qa-long-$TS','decision':'qa'}))" | chk || exit 1; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=Decision&limit=10'); echo "GET: $G" >&2; echo "$G" | jq -e '.data == []'
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technica
GET: {"success":true,"data":[],"total":0}
true
```

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s%N); R1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R1" >&2; echo "$R2" >&2; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=general&limit=200'); echo "GET hits: $(echo "$G" | jq -c --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '[.data[] | select(.topic==$a or .topic==$b) | {id,topic,category}]')" >&2; [ "$(echo "$R1" | tail -n1)" = "201" ] && [ "$(echo "$R2" | tail -n1)" = "201" ] && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$G" | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '([.data[] | select(.topic==$a)] | length == 1) and ([.data[] | select(.topic==$b)] | length == 1)'
```
```output
{"success":true,"data":{"id":"0c62f635-56a3-49f9-8467-db019c6dfce1","category":"general","topic":"qa-nocat-1791655850933290000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:10:50.940Z"}}
201
{"success":true,"data":{"id":"0352b8f2-9be9-4fa5-a995-c81aaed87e8d","category":"general","topic":"qa-emptycat-1791655850933290000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:10:50.950Z"}}
201
GET hits: [{"id":"0352b8f2-9be9-4fa5-a995-c81aaed87e8d","topic":"qa-emptycat-1791655850933290000","category":"general"},{"id":"0c62f635-56a3-49f9-8467-db019c6dfce1","topic":"qa-nocat-1791655850933290000","category":"general"}]
true
true
true
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R" >&2; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; ID=$(echo "$R" | sed '$d' | jq -er 'select(.data.category == "decision") | .data.id | select(. != null and . != "")') || exit 1; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=decision&limit=200'); echo "GET hit: $(echo "$G" | jq -c --arg id "$ID" '[.data[] | select(.id==$id) | {id,topic,category}]')" >&2; echo "$G" | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id==$id and .topic==$t and .category=="decision")] | length == 1'
```
```output
{"success":true,"data":{"id":"08f5ca64-3fdd-4cdb-8011-1979eddcb828","category":"decision","topic":"qa-decision-1791655855798472000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T13:10:55.806Z"}}
201
GET hit: [{"id":"08f5ca64-3fdd-4cdb-8011-1979eddcb828","topic":"qa-decision-1791655855798472000","category":"decision"}]
true
```

### T-5
对应: Q-5
verdict: PASS
说明：按 spec-review.mjs 真实 shape（含 `made_by:"ai"`）写判定点，201，且能按 topic 查回，`made_by` 落库为 `ai`。
```command
TS=$(date +%s%N); TOPIC="判定点[qa$TS#1]: qa"; BODY=$(jq -nc --arg t "$TOPIC" --arg s "coding-workflow:qa-$TS" '{category:"judgment",topic:$t,decision:"所选方法: x｜候选: y",reason:"依据: z",made_by:"ai",author:"coding-workflow",source_ref:$s}'); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$R" >&2; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000'); echo "GET hit: $(echo "$G" | jq -c --arg t "$TOPIC" '[.data[] | select(.topic==$t) | {id,topic,category,made_by}]')" >&2; echo "$G" | jq -e --arg t "$TOPIC" '[.data[] | select(.topic==$t and .category=="judgment")] | length == 1'
```
```output
{"success":true,"data":{"id":"d37b9cf1-91ed-472f-9c02-417b28d54ac4","category":"judgment","topic":"判定点[qa1791655860195577000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-10T13:11:00.204Z"}}
201
GET hit: [{"id":"d37b9cf1-91ed-472f-9c02-417b28d54ac4","topic":"判定点[qa1791655860195577000#1]: qa","category":"judgment","made_by":"ai"}]
true
```

### X-1
对应: I-1, I-2
场景: 用户传数组、对象、布尔，或带空格、全大写的 category，以及 `category:null`
verdict: PASS
说明：非字符串和变体全部 400，带 14 个合法值，不含 SQL 原文；`null` 按「不带 category」处理，201 写入 general；被拒的 topic 一行都没写进库。
```command
TS=$(date +%s%N); for c in '["decision"]' '{}' 'true' '" decision"' '"decision "' '"DECISION"'; do CODE=$(curl -s -o /tmp/qa_r5_x.json -w '%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":$c,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); echo "$c -> $CODE $(jq -c '{success,n:(.allowed_categories|length)}' /tmp/qa_r5_x.json)"; [ "$CODE" = "400" ] && ! grep -iqE 'decisions_category_chk|check constraint|violates|relation' /tmp/qa_r5_x.json || exit 1; done; CODE=$(curl -s -o /tmp/qa_r5_x.json -w '%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "null -> $CODE $(jq -c '.data.category' /tmp/qa_r5_x.json)"; [ "$CODE" = "201" ] && jq -e '.data.category == "general"' /tmp/qa_r5_x.json && G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?limit=1000') && echo "$G" | jq -e --arg t "qa-x-$TS" '[.data[] | select(.topic==$t)] | length == 0'
```
```output
["decision"] -> 400 {"success":false,"n":14}
{} -> 400 {"success":false,"n":14}
true -> 400 {"success":false,"n":14}
" decision" -> 400 {"success":false,"n":14}
"decision " -> 400 {"success":false,"n":14}
"DECISION" -> 400 {"success":false,"n":14}
null -> 201 "general"
true
true
```

### X-2
对应: I-1, I-3
场景: 同时并发 10 个非法请求（workflow_bogus）和 10 个合法请求（judgment）
verdict: PASS
说明：非法的 10 个全是 400，合法的 10 个全是 201，没有互相干扰；非法值零写入，合法值 10 条都能查到。（第一次跑时我的断言没处理 curl 输出不带换行，导致误判退出 1，HTTP 结果本身是一样的；下面是改了断言后的那次。）
```command
TS=$(date +%s%N); D=/tmp/qa_r5_conc2; rm -rf $D; mkdir -p $D; for i in $(seq 1 10); do curl -s -o $D/b$i.json -w '%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-conc-$TS\",\"decision\":\"qa\"}" > $D/c$i & curl -s -o $D/g$i.json -w '%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"qa-conc-ok-$TS-$i\",\"decision\":\"qa\"}" > $D/gc$i & done; wait; echo "bogus: $(cat $D/c* | sort | uniq -c | tr '\n' ' ')"; echo "judgment: $(cat $D/gc* | sort | uniq -c | tr '\n' ' ')"; G=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10'); J=$(curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000'); echo "bogus rows: $(echo "$G" | jq '.data|length')  judgment rows this run: $(echo "$J" | jq --arg p "qa-conc-ok-$TS-" '[.data[]|select(.topic|startswith($p))]|length')"; [ "$(cat $D/c* | sort -u)" = "400" ] && [ "$(cat $D/gc* | sort -u)" = "201" ] && echo "$G" | jq -e '.data == []' && echo "$J" | jq -e --arg p "qa-conc-ok-$TS-" '[.data[]|select(.topic|startswith($p))]|length == 10'
```
```output
bogus:   10 400 
judgment:   10 201 
bogus rows: 0  judgment rows this run: 10
true
true
```

### X-3
对应: I-1
严重度: 建议
场景: 调用方发了一个格式坏的 JSON body（`{bad json`），接口返回 HTTP 500，error 是 JSON 解析器的英文原文 "Expected property name or '}' in JSON at position 1 ..."，没说清楚是请求格式错。空 body、缺必填、非法 status 都正常返回中文 400。我对比了本 PR 和 origin/main 的服务端入口文件，没有改动，所以这是改动前就有的问题，不是本 PR 引入的，也不在 I-1~I-3 范围内。建议另立任务，加一个全局 body 解析错误处理，统一返回 400。
verdict: FAIL
```command
for b in '' '{bad json' '{"category":"workflow_bogus"}' '{"category":"workflow_bogus","topic":"qa-x","decision":"qa","status":"bogus_status"}'; do CODE=$(curl -s -o /tmp/qa_r5_e.json -w '%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$b"); echo "[$b] -> $CODE $(head -c 200 /tmp/qa_r5_e.json)"; done
```
```output
[] -> 400 {"success":false,"error":"topic 和 decision 为必填项"}
[{bad json] -> 500 {"success":false,"error":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}
[{"category":"workflow_bogus"}] -> 400 {"success":false,"error":"topic 和 decision 为必填项"}
[{"category":"workflow_bogus","topic":"qa-x","decision":"qa","status":"bogus_status"}] -> 400 {"success":false,"error":"status 非法，合法值：active|executed|expired"}
```
