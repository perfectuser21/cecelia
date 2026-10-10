---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5"]
---
# QA 报告（第 4 轮，环境 http://localhost:5305）

本轮开始时间：2026-10-10T17:34:15Z（UTC）。所有断言只查本轮请求带时间戳的 topic 或本轮返回的 id，不依赖预览库已有数据。

### T-1
对应: Q-1
verdict: PASS
非法 category 返回 400，`error` 以「category 非法，合法值：」开头，`allowed_categories` 含 decision/judgment/general，响应体里没有约束名或 SQL 原文；随后按该 category 查询为空，说明没有写入。
```command
bash -c 'TS=$(date +%s%N); R=$(curl -s -w "\n%{http_code}" -X POST http://localhost:5305/api/brain/strategic-decisions -H "Content-Type: application/json" -d "{\"category\":\"workflow_bogus\",\"topic\":\"qa-bogus-$TS\",\"decision\":\"qa 非法 category\"}"); echo "$R"; CODE=$(echo "$R" | tail -n1); BODY=$(echo "$R" | sed "\$d"); G=$(curl -s "http://localhost:5305/api/brain/strategic-decisions?category=workflow_bogus&limit=10"); echo "GET: $G"; [ "$CODE" = "400" ] && echo "$BODY" | jq -e ".success == false and (.error | startswith(\"category 非法，合法值：\")) and (.allowed_categories | length > 0) and (.allowed_categories | index(\"decision\") != null) and (.allowed_categories | index(\"judgment\") != null) and (.allowed_categories | index(\"general\") != null)" && ! echo "$BODY" | grep -qiE "decisions_category_chk|check constraint|violates|relation" && echo "$G" | jq -e ".data == []"'
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
`category:123` 连发 3 次、`"Decision"`（大小写变体）、5000 个 `a`，全部返回 400，都带非空 `allowed_categories`，都没有 SQL 原文，没有出现 500；`?category=Decision` 查询为空。
```command
bash -c 'set -o pipefail; TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; chk(){ R=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "$1"); C=$(echo "$R" | tail -n1); B=$(echo "$R" | sed "\$d"); echo "$2 -> $C $(echo "$B" | cut -c1-120)"; [ "$C" = "400" ] && echo "$B" | jq -e "(.allowed_categories | type == \"array\" and length > 0) and .success == false" >/dev/null && ! echo "$B" | grep -qiE "decisions_category_chk|check constraint|violates|relation"; }; chk "{\"category\":123,\"topic\":\"qa-num-$TS-1\",\"decision\":\"qa\"}" num1 && chk "{\"category\":123,\"topic\":\"qa-num-$TS-1\",\"decision\":\"qa\"}" num2 && chk "{\"category\":123,\"topic\":\"qa-num-$TS-1\",\"decision\":\"qa\"}" num3 && chk "{\"category\":\"Decision\",\"topic\":\"qa-case-$TS\",\"decision\":\"qa\"}" case && chk "$(python3 -c "import json;print(json.dumps({\"category\":\"a\"*5000,\"topic\":\"qa-long-$TS\",\"decision\":\"qa\"}))")" long && G=$(curl -s "$U?category=Decision&limit=10") && echo "GET Decision: $G" && echo "$G" | jq -e ".data == []"'
```
```output
num1 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
num2 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
num3 -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
case -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
long -> 400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|inva
GET Decision: {"success":true,"data":[],"total":0}
true
```

### T-3
对应: Q-2
verdict: PASS
同一个 `category:123` 请求连发 3 次，响应体和状态码逐字节相同，都是 400（检查「重复发送每次结果一样」）。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; A=$(curl -s -w "|%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":123,\"topic\":\"qa-rep-$TS\",\"decision\":\"qa\"}"); B=$(curl -s -w "|%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":123,\"topic\":\"qa-rep-$TS\",\"decision\":\"qa\"}"); C=$(curl -s -w "|%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":123,\"topic\":\"qa-rep-$TS\",\"decision\":\"qa\"}"); echo "1: ${A: -60}"; echo "2: ${B: -60}"; echo "3: ${C: -60}"; [ "$A" = "$B" ] && [ "$B" = "$C" ] && [ "${A##*|}" = "400" ] && echo SAME_400'
```
```output
1: ,"judgment","nfr","small-change","technical","testing"]}|400
2: ,"judgment","nfr","small-change","technical","testing"]}|400
3: ,"judgment","nfr","small-change","technical","testing"]}|400
SAME_400
```

### T-4
对应: Q-3
verdict: PASS
不带 category 和 `category:""` 都返回 201，`data.category` 为 `general`，topic 与传入一致；`?category=general&limit=200` 能按 topic 查到这两条。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R1=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"topic\":\"qa-nocat-$TS\",\"decision\":\"qa 不带 category\"}"); R2=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":\"\",\"topic\":\"qa-emptycat-$TS\",\"decision\":\"qa 空 category\"}"); echo "$R1"; echo "$R2"; G=$(curl -s "$U?category=general&limit=200"); echo "GET hits: $(echo "$G" | jq -c "[.data[] | select(.topic==\"qa-nocat-$TS\" or .topic==\"qa-emptycat-$TS\") | {topic,category}]")"; [ "$(echo "$R1" | tail -n1)" = "201" ] && [ "$(echo "$R2" | tail -n1)" = "201" ] && echo "$R1" | sed "\$d" | jq -e ".success == true and .data.category == \"general\" and .data.topic == \"qa-nocat-$TS\"" && echo "$R2" | sed "\$d" | jq -e ".success == true and .data.category == \"general\" and .data.topic == \"qa-emptycat-$TS\"" && echo "$G" | jq -e "([.data[] | select(.topic==\"qa-nocat-$TS\" or .topic==\"qa-emptycat-$TS\")] | length) == 2"'
```
```output
{"success":true,"data":{"id":"31a1ba0b-211b-42ca-9a07-5b685d000955","category":"general","topic":"qa-nocat-1791653682150778000","decision":"qa 不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T12:34:42.157Z"}}
201
{"success":true,"data":{"id":"44165bfb-b2ea-420b-adc9-5d427b658d41","category":"general","topic":"qa-emptycat-1791653682150778000","decision":"qa 空 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T12:34:42.166Z"}}
201
GET hits: [{"topic":"qa-emptycat-1791653682150778000","category":"general"},{"topic":"qa-nocat-1791653682150778000","category":"general"}]
true
true
true
```

### T-5
对应: Q-4
verdict: PASS
`category:"decision"` 返回 201，`data.id` 非空；`?category=decision&limit=200` 里能查到同一 id、同一 topic，category 为 decision。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":\"decision\",\"topic\":\"qa-decision-$TS\",\"decision\":\"qa 合法 category\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; ID=$(echo "$R" | sed "\$d" | jq -er "select(.data.category == \"decision\") | .data.id") || exit 1; G=$(curl -s "$U?category=decision&limit=200"); echo "GET match: $(echo "$G" | jq -c "[.data[] | select(.id==\"$ID\") | {id,topic,category}]")"; echo "$G" | jq -e "[.data[] | select(.id==\"$ID\" and .topic==\"qa-decision-$TS\" and .category==\"decision\")] | length == 1"'
```
```output
{"success":true,"data":{"id":"4e3e0d4a-fc65-4a0f-9c6c-9e4e31ea736b","category":"decision","topic":"qa-decision-1791653686842528000","decision":"qa 合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T12:34:46.849Z"}}
201
GET match: [{"id":"4e3e0d4a-fc65-4a0f-9c6c-9e4e31ea736b","topic":"qa-decision-1791653686842528000","category":"decision"}]
true
```

### T-6
对应: Q-5
verdict: FAIL
按 Q-5 原文的 body 发请求（`"made_by":"ai"`），期望 201，实际 **HTTP 500**，而且响应体把数据库约束原文 `decisions_made_by_check` 透给了调用方。这次被拒的原因是 made_by，不是 category：category 校验已经放行 `judgment`，请求随后在 `decisions_made_by_check` 处失败。
对照代码：`packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75` 当前已改成 `made_by: 'system'`（提交 69e717e9f「生产约束不允许 ai」），所以 Q-5 写的「真实调用方 shape」已经过时。按 Q-5 原文执行的结果不符合期望，判 FAIL。修法有两种，由开发方选：一是把 Q-5 的 body 更新为 `made_by:"system"`（当前 shape 已在 T-7 验过可以 201）；二是如果要求 `ai` 也能写入，就要改 made_by 约束。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"ai\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; G=$(curl -s "$U?category=judgment&limit=1000"); echo "GET match: $(echo "$G" | jq -c "[.data[] | select(.topic==\"判定点[qa$TS#1]: qa\") | {id,topic,category}]")"; echo "$G" | jq -e "[.data[] | select(.topic==\"判定点[qa$TS#1]: qa\" and .category==\"judgment\")] | length == 1"'
```
```output
{"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""}
500
```

### T-7
对应: Q-5
verdict: PASS
按真实调用方 `spec-review.mjs:70-77` **当前**的 shape（`made_by:"system"`，其余字段同 Q-5）发请求：返回 201；`?category=judgment&limit=1000` 能按 topic 查到这条，category 为 judgment。说明新的 category 校验没有误伤真实调用方。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; R=$(curl -s -w "\n%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":\"judgment\",\"topic\":\"判定点[qa$TS#1]: qa\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa-$TS\"}"); echo "$R"; [ "$(echo "$R" | tail -n1)" = "201" ] || exit 1; G=$(curl -s "$U?category=judgment&limit=1000"); echo "GET match: $(echo "$G" | jq -c "[.data[] | select(.topic==\"判定点[qa$TS#1]: qa\") | {id,topic,category}]")"; echo "$G" | jq -e "[.data[] | select(.topic==\"判定点[qa$TS#1]: qa\" and .category==\"judgment\")] | length == 1"'
```
```output
{"success":true,"data":{"id":"ab9f2b06-027d-49aa-9c65-9f6f027cd1b0","category":"judgment","topic":"判定点[qa1791653709176715000#1]: qa","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"system","priority":"P2","created_at":"2026-10-10T12:35:09.191Z"}}
201
GET match: [{"id":"ab9f2b06-027d-49aa-9c65-9f6f027cd1b0","topic":"判定点[qa1791653709176715000#1]: qa","category":"judgment"}]
true
```

### X-1
对应: I-1, I-2
verdict: PASS
探索了更多输入：布尔、数组、对象、前面带空格的 `" decision"` 都返回 400；`null` 按「不带 category」处理，返回 201 并写成 general；6 个不同的非法 category 并发提交，全部 400，没有 500；被拒请求一条都没有落库。
```command
bash -c 'TS=$(date +%s%N); U=http://localhost:5305/api/brain/strategic-decisions; OK=1; for c in "true" "[\"decision\"]" "{}" "\" decision\""; do R=$(curl -s -w "|%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":$c,\"topic\":\"qa-x-$TS\",\"decision\":\"qa\"}"); echo "category=$c -> ${R##*|}"; [ "${R##*|}" = "400" ] || OK=0; done; R=$(curl -s -w "|%{http_code}" -X POST $U -H "Content-Type: application/json" -d "{\"category\":null,\"topic\":\"qa-null-$TS\",\"decision\":\"qa\"}"); echo "category=null -> ${R##*|} $(echo "${R%|*}" | jq -c .data.category)"; [ "${R##*|}" = "201" ] && [ "$(echo "${R%|*}" | jq -r .data.category)" = "general" ] || OK=0; for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -X POST $U -H "Content-Type: application/json" -d "{\"category\":\"bogus-par-$i\",\"topic\":\"qa-par-$TS\",\"decision\":\"qa\"}" & done > /tmp/qa-par-$TS.txt; wait; echo "并发6次: $(sort /tmp/qa-par-$TS.txt | uniq -c | tr -s " ")"; [ "$(sort -u /tmp/qa-par-$TS.txt)" = "400" ] || OK=0; G=$(curl -s "$U?limit=1000"); N=$(echo "$G" | jq "[.data[] | select(.topic==\"qa-x-$TS\" or .topic==\"qa-par-$TS\")] | length"); echo "被拒请求落库条数: $N"; [ "$N" = "0" ] || OK=0; [ $OK = 1 ]'
```
```output
category=true -> 400
category=["decision"] -> 400
category={} -> 400
category=" decision" -> 400
category=null -> 201 "general"
并发6次:  6 400
被拒请求落库条数: 0
```

### X-2
对应: I-2
verdict: PASS
在 Dashboard 决策登记台（`/knowledge/decisions`，全新浏览器上下文）走一遍真实用户流程：点「记录决策」，只填主题和内容（category 用页面默认值 general），点「记录」。POST 返回 201、category 为 general，弹窗关闭后列表里出现了这条新决策。
截图: qa-r4/x-ui-1-list.png、qa-r4/x-ui-2-modal.png、qa-r4/x-ui-3-after.png
```command
node -e "
const { chromium } = require('playwright');
const SHOTS = 'sprints/10101755-cw-bd2b1556/qa-r4';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const topic = 'qa-ui-' + Date.now();
  await page.goto('http://localhost:5305/knowledge/decisions', { waitUntil: 'networkidle' });
  await page.screenshot({ path: SHOTS + '/x-ui-1-list.png', fullPage: true });
  await page.getByRole('button', { name: '记录决策' }).click();
  await page.getByPlaceholder('决策主题').fill(topic);
  await page.getByPlaceholder('具体的决策内容').fill('QA 通过页面登记的决策（默认 category=general）');
  await page.screenshot({ path: SHOTS + '/x-ui-2-modal.png', fullPage: true });
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/brain/strategic-decisions') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '记录', exact: true }).click(),
  ]);
  const body = await resp.json();
  console.log('POST status', resp.status(), 'category', body && body.data && body.data.category, 'topic', body && body.data && body.data.topic);
  await page.waitForTimeout(1500);
  const visible = await page.getByText(topic).count();
  console.log('列表中出现新主题条数', visible);
  await page.screenshot({ path: SHOTS + '/x-ui-3-after.png', fullPage: true });
  await browser.close();
  if (resp.status() !== 201 || !body.data || body.data.category !== 'general' || visible < 1) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```
```output
POST status 201 category general topic qa-ui-1791653746513
列表中出现新主题条数 1
```

### X-3
对应: I-1
严重度: 建议
场景: 用户在 Dashboard 决策登记台照着 category 输入框的占位提示「如 technical、product、strategy」填了 `product`，然后点「记录」。接口按本 PR 的要求正确返回 400 并列出合法值，但页面不看返回状态：弹窗直接关闭，没有任何错误提示，列表里也没有这条决策，用户以为保存成功了，实际上什么都没写进去。另外占位提示里的 product、strategy 本身就不在合法值里，等于在引导用户填错。规格「未覆盖真实链路」一节已经把前端提示列为需求外的另立任务，所以这里记为建议，不阻断本 PR。
verdict: FAIL
截图: qa-r4/x-ui-4-bad-category.png
```command
node -e "
const { chromium } = require('playwright');
const SHOTS = 'sprints/10101755-cw-bd2b1556/qa-r4';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const topic = 'qa-ui-bad-' + Date.now();
  await page.goto('http://localhost:5305/knowledge/decisions', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '记录决策' }).click();
  await page.getByPlaceholder('决策主题').fill(topic);
  await page.getByPlaceholder('具体的决策内容').fill('QA 页面填非法 category');
  await page.getByPlaceholder('如 technical、product、strategy').fill('product');
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/brain/strategic-decisions') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '记录', exact: true }).click(),
  ]);
  const body = await resp.json();
  console.log('POST status', resp.status(), 'error', body.error);
  await page.waitForTimeout(1500);
  const modalOpen = await page.getByPlaceholder('决策主题').count();
  const hint = await page.getByText('category 非法').count();
  console.log('弹窗仍打开', modalOpen, '页面可见错误提示', hint, '列表出现该主题', await page.getByText(topic).count());
  await page.screenshot({ path: SHOTS + '/x-ui-4-bad-category.png', fullPage: true });
  await browser.close();
  if (resp.status() !== 400 || hint < 1) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```
```output
POST status 400 error category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing
弹窗仍打开 0 页面可见错误提示 0 列表出现该主题 0
```
