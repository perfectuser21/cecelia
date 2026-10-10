---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 1 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T11:07:57Z。所有请求只发往 PREVIEW_URL，每条用例用纳秒时间戳造独立 topic/id，不依赖预览库已有数据。本轮场景全是接口类，没有开浏览器，所以没有截图。

| 场景 | 结论 |
|---|---|
| Q-1 非法 category → 400 + 允许值，不透出 SQL | PASS |
| Q-2 边界值（123 / Decision / 5000 字符，连发 3 次） | PASS |
| Q-3 不带 category / 空串 → 201，默认 general | PASS |
| Q-4 合法 decision → 201，GET 能查到 | PASS |
| Q-5 coding-workflow 判定点真实格式 | **FAIL**：返回 500，`made_by:"ai"` 撞上 `decisions_made_by_check`，响应里透出了 SQL 原文 |

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; BODY=$(echo "$R" | sed '$d'); CODE=$(echo "$R" | tail -n1); test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.error | startswith("category 非法，合法值：")) and (.allowed_categories | type == "array" and length > 0 and index("decision") != null and index("judgment") != null and index("general") != null)' && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10' | jq -e '.data == []' && echo Q1_OK
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
```command
TS=$(date +%s%N); ok=1; for B in "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}" "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}" "{\"category\":123,\"topic\":\"qa-num-$TS\",\"decision\":\"qa\"}" "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" "$(python3 -c "import json,sys; print(json.dumps({'category':'a'*5000,'topic':'qa-long-'+sys.argv[1],'decision':'qa'}))" "$TS")"; do R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' --data-binary "$B"); BODY=$(echo "$R" | sed '$d'); CODE=$(echo "$R" | tail -n1); echo "$CODE $(echo "$BODY" | jq -c '{success, n: (.allowed_categories|length)}')"; { test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.allowed_categories | type == "array" and length > 0)' >/dev/null && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation'; } || ok=0; done; test $ok = 1 && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=Decision&limit=10' | jq -e '.data == []' && echo Q2_OK
```
```output
400 {"success":false,"n":14}
400 {"success":false,"n":14}
400 {"success":false,"n":14}
400 {"success":false,"n":14}
400 {"success":false,"n":14}
true
Q2_OK
```
依次是：`123` 连发 3 次、`Decision`、5000 个 `a`。全部返回 400，每个响应都带 14 个允许值，都没有 SQL 原文，三次重复结果一样；GET `?category=Decision` 查出来是空。

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s%N); R1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R1"; echo "$R2"; test "$(echo "$R1" | tail -n1)" = "201" && test "$(echo "$R2" | tail -n1)" = "201" && echo "$R1" | sed '$d' | jq -e --arg t "qa-nocat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && echo "$R2" | sed '$d' | jq -e --arg t "qa-emptycat-$TS" '.success == true and .data.category == "general" and .data.topic == $t' && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=general&limit=200' | jq -e --arg a "qa-nocat-$TS" --arg b "qa-emptycat-$TS" '([.data[] | select(.topic == $a or .topic == $b)] | length) == 2' && echo Q3_OK
```
```output
{"success":true,"data":{"id":"f28d050d-a9b5-4d17-9e83-1bc5cb54d0e3","category":"general","topic":"qa-nocat-1791630528477436000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:08:48.483Z"}}
201
{"success":true,"data":{"id":"6ff47f82-1667-48e6-a7b5-c8c2a1102ba7","category":"general","topic":"qa-emptycat-1791630528477436000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:08:48.492Z"}}
201
true
true
true
Q3_OK
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; ID=$(echo "$R" | sed '$d' | jq -er '.data | select(.category == "decision") | .id'); test "$(echo "$R" | tail -n1)" = "201" && test -n "$ID" && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=decision&limit=200' | jq -e --arg id "$ID" --arg t "qa-decision-$TS" '[.data[] | select(.id == $id and .topic == $t and .category == "decision")] | length == 1' && echo Q4_OK
```
```output
{"success":true,"data":{"id":"99810276-64ad-4bde-9352-0a59fea54bfa","category":"decision","topic":"qa-decision-1791630530925335000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T06:08:50.932Z"}}
201
true
Q4_OK
```

### T-5
对应: Q-5
verdict: FAIL
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "201" && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -e --arg t "判定点[qa$TS#1]: qa" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1' && echo Q5_OK
```
```output
{"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""}
500
```
（退出码 1）

结果不符合期望：要求 201，实际返回 500，而且响应体原样透出了数据库约束原文 `violates check constraint "decisions_made_by_check"`。原因：`made_by:"ai"` 不在 `decisions_made_by_check` 的允许值里（迁移 `packages/brain/migrations/193_knowledge_doc_author.sql:10` 写的是 `CHECK (made_by IN ('user', 'cecelia', 'system'))`）。category=`judgment` 本身没问题（见 X-1）。这和 category 是同一类问题（迁移建出来的库与线上约束不一致）：真实调用方 `spec-review.mjs` 写判定点用的 body 在从迁移建出的库上（预览环境、CI 空库）会直接 500。这次 PR 的 diff 没有碰 `made_by`，是存量问题，不是本 PR 引入的；但 Q-5 是双方认可的验收场景，期望不成立就判 FAIL。

### X-1
对应: Q-5, I-3
verdict: PASS
场景: 用 Q-5 的同一个 body，只去掉 `made_by`，用来确认 category 新校验没有误伤 `judgment`
```command
TS=$(date +%s%N); R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#2]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; test "$(echo "$R" | tail -n1)" = "201" && curl -s 'http://localhost:5305/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -e --arg t "判定点[qa$TS#2]: qa" '[.data[] | select(.topic == $t and .category == "judgment")] | length == 1' && echo JUDGMENT_NO_MADEBY_OK
```
```output
{"success":true,"data":{"id":"95992182-b7e2-4b5f-add0-4b586836fcfc","category":"judgment","topic":"判定点[qa1791630541097530000#2]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"user","priority":"P2","created_at":"2026-10-10T06:09:01.108Z"}}
201
true
JUDGMENT_NO_MADEBY_OK
```
结论：category 新校验放行了 `judgment`，所以 T-5 的 500 只由 `made_by` 引起。

### X-2
对应: I-1, I-2
verdict: PASS
场景: 前面带空格、数组、对象、布尔这几种 category 应返回 400；`null` 应按「不带 category」处理
```command
TS=$(date +%s%N); ok=1; for C in '" decision"' '["decision"]' '{}' 'true'; do R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":$C,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); BODY=$(echo "$R" | sed '$d'); CODE=$(echo "$R" | tail -n1); echo "$C -> $CODE $(echo "$BODY" | cut -c1-60)"; { test "$CODE" = "400" && echo "$BODY" | jq -e '.success == false and (.allowed_categories|length > 0)' >/dev/null && ! echo "$BODY" | grep -qiE 'decisions_category_chk|check constraint|violates|relation'; } || ok=0; done; R=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "null -> $(echo "$R" | tail -n1) $(echo "$R" | sed '$d' | jq -c '.data.category')"; test "$(echo "$R" | tail -n1)" = "201" || ok=0; test $ok = 1 && echo X_TYPES_OK
```
```output
" decision" -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-f
["decision"] -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-f
{} -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-f
true -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-f
null -> 201 "general"
X_TYPES_OK
```

### X-3
对应: Q-2, I-1
verdict: PASS
场景: 同时并发发 10 个非法 category 请求，应该全部 400，并且不写库
```command
TS=$(date +%s%N); D=$(mktemp -d); for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5305/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "{\"category\":\"bogus_conc_$TS\",\"topic\":\"qa-conc-$TS-$i\",\"decision\":\"qa\"}" > "$D/$i" & done; wait; cat "$D"/* | sort | uniq -c; test "$(cat "$D"/* | sort -u)" = "400" && curl -s "http://localhost:5305/api/brain/strategic-decisions?category=bogus_conc_$TS&limit=10" | jq -e '.data == []' && echo X_CONC_OK
```
```output
  10 400
true
X_CONC_OK
```
