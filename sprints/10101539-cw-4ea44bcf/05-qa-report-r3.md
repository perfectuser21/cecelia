---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-7", "02-spec.md#Q-8", "02-spec.md#Q-6"]
---
# QA 报告（第 3 轮，环境 http://localhost:5300）

本轮开始时间：2026-10-10T09:41:42Z（UTC）。所有命令只访问预览环境 http://localhost:5300；每条命令自己生成随机串造数据，只按本轮生成的 topic 断言，不依赖预览库已有数据。Dashboard 由预览 Brain 直接托管（`PREVIEW_STATIC_DIR`），页面地址 `http://localhost:5300/knowledge/decisions`，Playwright 脚本拦截所有非 `localhost:5300` 的请求（输出中 `blocked_hosts=[]`，页面没有访问任何其他地址）。

### T-1
对应: Q-1
verdict: PASS
非法 category `workflow_bogus` → HTTP 400，`success=false`，`allowed_categories` 共 13 个值（含 decision/judgment/testing），`error` 列出合法值，响应不含约束名/SQL 原文；GET 列表里查不到该 topic。
```command
R=$(openssl rand -hex 4); T="QA-cat-bogus-$R"; RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$T\",\"decision\":\"非法类别探针\"}"); echo "$RESP"; BODY=$(echo "$RESP" | sed '$d'); CODE=$(echo "$RESP" | tail -1); test "$CODE" = 400 && echo "$BODY" | jq -e '.success==false and (.allowed_categories|length==13) and (.allowed_categories|index("decision")!=null) and (.allowed_categories|index("judgment")!=null) and (.allowed_categories|index("testing")!=null) and (.error|test("decision")) and (.error|test("judgment"))' && ! echo "$BODY" | grep -Eq 'decisions_category_chk|violates|relation|check constraint' && curl -s 'http://localhost:5300/api/brain/strategic-decisions?limit=200' | jq -e --arg t "$T" '.success==true and ([.data[]|select(.topic==$t)]|length==0)' && echo "Q1 PASS topic=$T"
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
true
Q1 PASS topic=QA-cat-bogus-9ae01105
```

### T-2
对应: Q-2
verdict: PASS
`"Decision"`、数字 `1`、数组 `["decision"]`、10000 个 `a` 四种 category 均 400，均带 13 项 `allowed_categories`，均不含约束名 / SQL 原文 / `value too long`；GET 列表查不到这四个 topic。
```command
R=$(openssl rand -hex 4); LONG=$(printf 'a%.0s' $(seq 1 10000)); FAIL=0; i=0; for CAT in '"Decision"' '1' '["decision"]' "\"$LONG\""; do i=$((i+1)); T="QA-cat-q2-$i-$R"; RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":$CAT,\"topic\":\"$T\",\"decision\":\"Q2探针\"}"); BODY=$(echo "$RESP" | sed '$d'); CODE=$(echo "$RESP" | tail -1); echo "case$i code=$CODE body=$(echo "$BODY" | head -c 160)"; if [ "$CODE" != 400 ] || ! echo "$BODY" | jq -e '.success==false and (.allowed_categories|length==13)' >/dev/null || echo "$BODY" | grep -Eq 'decisions_category_chk|violates|relation|check constraint|value too long'; then FAIL=1; fi; done; curl -s 'http://localhost:5300/api/brain/strategic-decisions?limit=200' | jq -e --arg r "$R" '[.data[]|select(.topic|startswith("QA-cat-q2-") and endswith($r))]|length==0' && test $FAIL = 0 && echo "Q2 PASS R=$R"
```
```output
case1 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case2 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case3 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case4 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
true
Q2 PASS R=7fa01675
```

### T-3
对应: Q-3
verdict: PASS
不带 category、`""`、`null` 三次都 201，`data.category=decision`，`data.id` 非空；`GET ?category=decision&limit=200` 能找到全部 3 条。
```command
R=$(openssl rand -hex 4); FAIL=0; for V in none empty null; do T="QA-cat-default-$V-$R"; case $V in none) B="{\"topic\":\"$T\",\"decision\":\"不带类别\"}";; empty) B="{\"topic\":\"$T\",\"decision\":\"空类别\",\"category\":\"\"}";; null) B="{\"topic\":\"$T\",\"decision\":\"null类别\",\"category\":null}";; esac; RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "$B"); BODY=$(echo "$RESP" | sed '$d'); CODE=$(echo "$RESP" | tail -1); echo "$V code=$CODE category=$(echo "$BODY" | jq -r .data.category) id=$(echo "$BODY" | jq -r .data.id)"; if [ "$CODE" != 201 ] || ! echo "$BODY" | jq -e '.data.category=="decision" and (.data.id|type=="string" and length>0)' >/dev/null; then FAIL=1; fi; done; curl -s 'http://localhost:5300/api/brain/strategic-decisions?category=decision&limit=200' | jq -e --arg r "$R" '[.data[]|select(.topic|startswith("QA-cat-default-") and endswith($r))]|length==3' && test $FAIL = 0 && echo "Q3 PASS R=$R"
```
```output
none code=201 category=decision id=6d478446-a6cc-4c61-a784-7ea681206e39
empty code=201 category=decision id=9c9cd3cb-2599-48a3-b154-144a1a41e009
null code=201 category=decision id=11b78f88-bc71-441f-b0ca-2cd88eea926f
true
Q3 PASS R=07750001
```

### T-4
对应: Q-4
verdict: PASS
`category=decision` POST 201、`data.category=decision`；GET `?category=decision` 返回 200，该 topic 恰好 1 条，`category=decision`、`status=active`。
```command
R=$(openssl rand -hex 4); T="QA-cat-valid-$R"; RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"合法类别\"}"); echo "$RESP" | head -c 300; echo; CODE=$(echo "$RESP" | tail -1); test "$CODE" = 201 && echo "$RESP" | sed '$d' | jq -e '.data.category=="decision"' && G=$(curl -s -w '\n%{http_code}' 'http://localhost:5300/api/brain/strategic-decisions?category=decision&limit=200') && test "$(echo "$G" | tail -1)" = 200 && echo "$G" | sed '$d' | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].category=="decision" and $m[0].status=="active"' && echo "Q4 PASS topic=$T"
```
```output
{"success":true,"data":{"id":"bb7ca2d8-cbb8-41b2-a77e-f37b02369db5","category":"decision","topic":"QA-cat-valid-d514403d","decision":"合法类别","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T04:42:11.287Z"}}
201

true
true
Q4 PASS topic=QA-cat-valid-d514403d
```

### T-5
对应: Q-5
verdict: PASS
按 coding workflow 判定点真实 shape（category=judgment、made_by=system、author=coding-workflow、source_ref）POST 201；`GET ?category=judgment&limit=1000` 按 topic 找到恰好 1 条，`made_by=system`、`author=coding-workflow`。
```command
R=$(openssl rand -hex 4); T="判定点[qa000000#1]: QA-$R"; B=$(jq -nc --arg t "$T" '{category:"judgment",topic:$t,decision:"所选方法: x｜候选: y",reason:"依据: z",made_by:"system",author:"coding-workflow",source_ref:"coding-workflow:qa"}'); RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "$B"); echo "$RESP" | head -c 300; echo; test "$(echo "$RESP" | tail -1)" = 201 && curl -s 'http://localhost:5300/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].made_by=="system" and $m[0].author=="coding-workflow" and $m[0].category=="judgment"' && echo "Q5 PASS topic=$T"
```
```output
{"success":true,"data":{"id":"d6266a88-3bab-4d11-b9f4-72d20ccac63f","category":"judgment","topic":"判定点[qa000000#1]: QA-1aeda4fd","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-1
true
Q5 PASS topic=判定点[qa000000#1]: QA-1aeda4fd
```

### T-6
对应: Q-7
verdict: PASS
`made_by:"ai"` → 400 带 `allowed_made_by=["user","cecelia","system"]`；`priority:"P9"` → 400 带 `allowed_priorities=["P0","P1","P2","P3"]`；两条响应都不含 `check constraint` / `violates`；GET 列表查不到这两个 topic。
```command
R=$(openssl rand -hex 4); T1="QA-madeby-$R"; T2="QA-prio-$R"; R1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"$T1\",\"decision\":\"旧 shape 探针\",\"made_by\":\"ai\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"topic\":\"$T2\",\"decision\":\"优先级探针\",\"priority\":\"P9\"}"); echo "$R1"; echo "$R2"; test "$(echo "$R1" | tail -1)" = 400 && test "$(echo "$R2" | tail -1)" = 400 && echo "$R1" | sed '$d' | jq -e '.success==false and .allowed_made_by==["user","cecelia","system"]' && echo "$R2" | sed '$d' | jq -e '.success==false and .allowed_priorities==["P0","P1","P2","P3"]' && ! printf '%s\n%s' "$R1" "$R2" | grep -Eq 'check constraint|violates' && curl -s 'http://localhost:5300/api/brain/strategic-decisions?limit=200' | jq -e --arg a "$T1" --arg b "$T2" '[.data[]|select(.topic==$a or .topic==$b)]|length==0' && echo "Q7 PASS R=$R"
```
```output
{"success":false,"error":"made_by 非法，合法值：user|cecelia|system","allowed_made_by":["user","cecelia","system"]}
400
{"success":false,"error":"priority 非法，合法值：P0|P1|P2|P3","allowed_priorities":["P0","P1","P2","P3"]}
400
true
true
true
Q7 PASS R=72f1e253
```

### T-7
对应: Q-8
verdict: PASS
截图: qa-r3/q8-1-filled-default.png、qa-r3/q8-2-default-created.png、qa-r3/q8-3-bad-error.png
全新浏览器上下文打开预览环境 `/knowledge/decisions`：① 分类留空提交 → POST 201、弹窗关闭、列表出现 `QA-ui-default-*` 且所在分组为 `decision`；② 分类填 `product` 提交 → POST 400、弹窗保持打开、弹窗内红字显示「category 非法，合法值：…decision…judgment…」，取消后列表中没有 `QA-ui-bad-*`。
说明：同一脚本首次运行时我用 `innerText` 读分组标题，被页面 CSS `uppercase` 转成了 `DECISION` 导致断言误报（输出 `group=DECISION … Q8 FAIL`，页面行为本身与期望一致）；改用 `textContent` 读取原始文字后重跑（新随机串、新浏览器上下文），下面是重跑的命令与输出。
```command
sed -i '' "s/locator('h2').innerText()).trim()/locator('h2').textContent()).trim()/" /tmp/qa8-r3.cjs && grep -n "textContent" /tmp/qa8-r3.cjs && node /tmp/qa8-r3.cjs
```
```output
22:  const group1 = (await page.locator('div.mb-6', { has: page.getByText(t1) }).locator('h2').textContent()).trim();
step1 modal_closed=true topic_in_list=true group=decision
step2 modal_open=true error="category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing" bad_topic_in_list=0
post_statuses=[201,400] blocked_hosts=[]
Q8 PASS
```

### T-8
对应: Q-6
verdict: PASS
同一合法 body 连发两次 → 201、201，GET 查到 2 条同 topic；同一非法 body 连发两次 → 400、400，两次响应完全一致，GET 查不到该 topic。
```command
R=$(openssl rand -hex 4); T="QA-cat-dup-$R"; TB="QA-cat-dupbad-$R"; C1=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); B1=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); B2=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); echo "valid: $C1 $C2"; echo "bad1: $(echo "$B1" | tail -1) bad2: $(echo "$B2" | tail -1) same_body=$([ "$B1" = "$B2" ] && echo yes || echo no)"; test "$C1" = 201 && test "$C2" = 201 && test "$(echo "$B1" | tail -1)" = 400 && test "$B1" = "$B2" && curl -s 'http://localhost:5300/api/brain/strategic-decisions?category=decision&limit=200' | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==2' && curl -s 'http://localhost:5300/api/brain/strategic-decisions?limit=200' | jq -e --arg t "$TB" '[.data[]|select(.topic==$t)]|length==0' && echo "Q6 PASS R=$R"
```
```output
valid: 201 201
bad1: 400 bad2: 400 same_body=yes
true
true
Q6 PASS R=eda0eb8f
```

### X-1
对应: I-1
verdict: PASS
场景: 用户发空 body、带前导空格的 ` decision`、对象类型 category，以及按不存在的类别查询。空 body 返回 400 + 人话提示「topic 和 decision 为必填项」；` decision` 与对象类别都返回 400 并列出合法值，且都没写进库；查不存在的类别返回 200 空列表。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6220-3; git fetch -q origin main 2>/dev/null; git diff --stat origin/main...HEAD -- packages/brain/server.js | tail -1; echo "diffcheck-done"; U=http://localhost:5300/api/brain/strategic-decisions; for B in '{"topic":"QA-x-space","decision":"d","category":" decision"}' '{"topic":"QA-x-obj","decision":"d","category":{"a":1}}'; do curl -s -o /dev/null -w '%{http_code}\n' -X POST $U -H 'content-type: application/json' -d "$B"; done; curl -s "$U?limit=200" | jq -e '[.data[]|select(.topic=="QA-x-space" or .topic=="QA-x-obj")]|length==0'
```
```output
diffcheck-done
400
400
true
```

### X-2
对应: I-1
严重度: 建议
场景: 调用方发出不完整的 JSON（`{"topic":`），接口返回 HTTP 500 和 JSON 解析器原文「Unexpected end of JSON input」。这是客户端输入错误，按理应返回 400。该行为来自 server.js 全局错误处理器，本 PR 没有改 server.js（上面 X-1 命令里 `git diff --stat origin/main...HEAD -- packages/brain/server.js` 输出为空），属于既有问题，不是本次引入的；也不是数据库报错外泄，不影响 I-1 结论。建议另开单处理。
verdict: FAIL
```command
U=http://localhost:5300/api/brain/strategic-decisions; echo "--empty:"; curl -s -w ' [%{http_code}]\n' -X POST $U -H 'content-type: application/json' -d '{}'; echo "--badjson:"; curl -s -w ' [%{http_code}]\n' -X POST $U -H 'content-type: application/json' -d '{"topic":'; echo "--space:"; curl -s -w ' [%{http_code}]\n' -X POST $U -H 'content-type: application/json' -d '{"topic":"QA-x-space","decision":"d","category":" decision"}' | cut -c1-80; echo "--object:"; curl -s -w ' [%{http_code}]\n' -X POST $U -H 'content-type: application/json' -d '{"topic":"QA-x-obj","decision":"d","category":{"a":1}}' | cut -c1-80; echo "--get-unknown:"; curl -s -w ' [%{http_code}]\n' "$U?category=no_such_cat_qa" | cut -c1-200
```
```output
--empty:
{"success":false,"error":"topic 和 decision 为必填项"} [400]
--badjson:
{"success":false,"error":"Unexpected end of JSON input"} [500]
--space:
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployme
--object:
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployme
--get-unknown:
{"success":true,"data":[],"total":0} [200]
```

### X-3
对应: I-3
严重度: 建议
场景: 新建决策返回的 `created_at` 比服务器当前时间早 5 小时（响应头 Date 是 09:43:12 GMT，记录 created_at 是 04:43:12Z），Dashboard 卡片上显示的日期也因此是 2026/10/9。本 PR 的路由 diff 没有改 created_at 的写入（只有 RETURNING 那一行出现在 diff 上下文里），像是列默认值/时区的既有问题，不是本次引入的，不影响 I-3「能写入、能查到」。建议另开单排查。
verdict: FAIL
```command
R=$(openssl rand -hex 4); H=$(mktemp); B=$(curl -s -D "$H" -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d "{\"topic\":\"QA-x-time-$R\",\"decision\":\"时间戳探针\"}"); grep -i '^date:' "$H"; echo "$B" | jq -r '.data.created_at'; date -u +%Y-%m-%dT%H:%M:%SZ
```
```output
Date: Sat, 10 Oct 2026 09:43:12 GMT
2026-10-10T04:43:12.048Z
2026-10-10T09:43:12Z
```
