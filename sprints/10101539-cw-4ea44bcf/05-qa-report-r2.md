---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-7", "02-spec.md#Q-8", "02-spec.md#Q-6"]
---
# QA 报告（第 2 轮，环境 http://localhost:5300）

本轮开始时间：2026-10-10T09:10:33Z（本机 UTC）。所有断言只针对本轮命令内新造的随机 topic / 返回的 id，不依赖预览库历史数据。

### T-1
对应: Q-1
verdict: PASS
非法 category `workflow_bogus` → 400，`success=false`，`allowed_categories` 13 个值且含 decision/judgment/testing，error 列出合法值，响应不含约束名/SQL 原文；GET 列表查不到该 topic。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; T="QA-cat-bogus-$(date +%s)-$RANDOM"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$T\",\"decision\":\"非法类别探针\"}"); echo "$R"; CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d'); test "$CODE" = 400; echo "$BODY" | jq -e '.success==false and (.allowed_categories|length==13) and (.allowed_categories|index("decision")!=null) and (.allowed_categories|index("judgment")!=null) and (.allowed_categories|index("testing")!=null) and (.error|test("decision")) and (.error|test("judgment"))'; ! echo "$BODY" | grep -Eq 'decisions_category_chk|violates|relation|check constraint'; curl -s "$B?limit=200" | jq -e --arg t "$T" '.success==true and ([.data[]|select(.topic==$t)]|length==0)'; echo "Q-1 OK topic=$T"
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
true
Q-1 OK topic=QA-cat-bogus-1791623439-18109
```

### T-2
对应: Q-2
verdict: PASS
`"Decision"`、`1`、`["decision"]`、10000 个 a 四种 category 均 400，带 13 值 `allowed_categories`，无约束名/SQL/截断报错原文；GET 列表查不到这四个 topic。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; S="$(date +%s)-$RANDOM"; LONG=$(printf 'a%.0s' $(seq 1 10000)); i=0; for CAT in '"Decision"' '1' '["decision"]' "\"$LONG\""; do i=$((i+1)); T="QA-cat-adv-$i-$S"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":$CAT,\"topic\":\"$T\",\"decision\":\"对抗探针\"}"); CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d'); echo "case$i code=$CODE body=$(echo "$BODY" | head -c 160)"; test "$CODE" = 400; echo "$BODY" | jq -e '.success==false and (.allowed_categories|length==13)' >/dev/null; ! echo "$BODY" | grep -Eq 'decisions_category_chk|violates|relation|check constraint|value too long|varchar'; done; curl -s "$B?limit=200" | jq -e --arg s "$S" '[.data[]|select(.topic|endswith($s))]|length==0'; echo "Q-2 OK suffix=$S"
```
```output
case1 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case2 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case3 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
case4 code=400 body={"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|te
true
Q-2 OK suffix=1791623445-24167
```

### T-3
对应: Q-3
verdict: PASS
不带 category / `""` / `null` 三次均 201，`data.category=decision`、`data.id` 非空；`?category=decision` 查询恰好找到这三条。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; S="$(date +%s)-$RANDOM"; i=0; for EXTRA in '' ',"category":""' ',"category":null'; do i=$((i+1)); T="QA-cat-default-$i-$S"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"topic\":\"$T\",\"decision\":\"不带类别\"$EXTRA}"); CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d'); echo "case$i code=$CODE $(echo "$BODY" | jq -c '{success,category:.data.category,id:.data.id}')"; test "$CODE" = 201; echo "$BODY" | jq -e '.data.category=="decision" and (.data.id|length>0)' >/dev/null; done; curl -s "$B?category=decision&limit=200" | jq -e --arg s "$S" '[.data[]|select(.topic|endswith($s))|select(.category=="decision")]|length==3'; echo "Q-3 OK suffix=$S"
```
```output
case1 code=201 {"success":true,"category":"decision","id":"1566c8c9-4255-4674-9713-520a5026cf71"}
case2 code=201 {"success":true,"category":"decision","id":"addd4290-0da7-4064-8bc4-f2624b07286f"}
case3 code=201 {"success":true,"category":"decision","id":"8399cb07-92c5-4390-a7b5-8a181d8f7bcc"}
true
Q-3 OK suffix=1791623448-19105
```

### T-4
对应: Q-4
verdict: PASS
合法 `decision` → 201；GET 200，该 topic 有且仅有一条，category=decision、status=active。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; T="QA-cat-valid-$(date +%s)-$RANDOM"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"合法类别\"}"); CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d'); echo "post code=$CODE $(echo "$BODY" | jq -c '{success,category:.data.category,status:.data.status}')"; test "$CODE" = 201; echo "$BODY" | jq -e '.data.category=="decision"' >/dev/null; G=$(curl -s -w '\n%{http_code}' "$B?category=decision&limit=200"); GC=$(echo "$G" | tail -1); echo "get code=$GC"; test "$GC" = 200; echo "$G" | sed '$d' | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].category=="decision" and $m[0].status=="active"'; echo "Q-4 OK topic=$T"
```
```output
post code=201 {"success":true,"category":"decision","status":"active"}
get code=200
true
Q-4 OK topic=QA-cat-valid-1791623452-22759
```

### T-5
对应: Q-5
verdict: PASS
按 coding workflow 真实 shape（judgment + made_by=system + author=coding-workflow + source_ref）写入 201，`?category=judgment&limit=1000` 能回读，made_by/author 正确。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; T="判定点[qa000000#1]: QA-$(date +%s)-$RANDOM"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"$T\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa\"}"); CODE=$(echo "$R" | tail -1); echo "post code=$CODE"; test "$CODE" = 201; curl -s "$B?category=judgment&limit=1000" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].made_by=="system" and $m[0].author=="coding-workflow" and $m[0].category=="judgment"'; echo "Q-5 OK topic=$T"
```
```output
post code=201
true
Q-5 OK topic=判定点[qa000000#1]: QA-1791623455-17845
```

### T-6
对应: Q-7
verdict: PASS
`made_by:"ai"` → 400 带 `allowed_made_by`；`priority:"P9"` → 400 带 `allowed_priorities`；均无 check constraint/violates 原文；两个 topic 未入库。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; S="$(date +%s)-$RANDOM"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"QA-madeby-$S\",\"decision\":\"旧 shape 探针\",\"made_by\":\"ai\"}"); echo "$R"; test "$(echo "$R" | tail -1)" = 400; echo "$R" | sed '$d' | jq -e '.success==false and .allowed_made_by==["user","cecelia","system"]' >/dev/null; ! echo "$R" | grep -Eq 'check constraint|violates'; R2=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"topic\":\"QA-prio-$S\",\"decision\":\"优先级探针\",\"priority\":\"P9\"}"); echo "$R2"; test "$(echo "$R2" | tail -1)" = 400; echo "$R2" | sed '$d' | jq -e '.success==false and .allowed_priorities==["P0","P1","P2","P3"]' >/dev/null; ! echo "$R2" | grep -Eq 'check constraint|violates'; curl -s "$B?limit=200" | jq -e --arg s "$S" '[.data[]|select(.topic|endswith($s))]|length==0'; echo "Q-7 OK suffix=$S"
```
```output
{"success":false,"error":"made_by 非法，合法值：user|cecelia|system","allowed_made_by":["user","cecelia","system"]}
400
{"success":false,"error":"priority 非法，合法值：P0|P1|P2|P3","allowed_priorities":["P0","P1","P2","P3"]}
400
true
Q-7 OK suffix=1791623459-29373
```

### T-7
对应: Q-6
verdict: PASS
第 1 次运行：同一合法 body 连发两次均 201，GET 查到两条同 topic；同一非法 body 连发两次均 400 且响应（含状态码）逐字一致，未入库。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; S="$(date +%s)-$RANDOM"; T="QA-cat-dup-$S"; for n in 1 2; do C=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); echo "valid#$n code=$C"; test "$C" = 201; done; TB="QA-cat-dupbad-$S"; B1=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); B2=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); echo "bad#1 code=$(echo "$B1"|tail -1) bad#2 code=$(echo "$B2"|tail -1)"; test "$(echo "$B1"|tail -1)" = 400; test "$B1" = "$B2"; curl -s "$B?category=decision&limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==2'; curl -s "$B?limit=200" | jq -e --arg t "$TB" '[.data[]|select(.topic==$t)]|length==0'; echo "Q-6 OK suffix=$S"
```
```output
valid#1 code=201
valid#2 code=201
bad#1 code=400 bad#2 code=400
true
true
Q-6 OK suffix=1791623465-10759
```

### T-8
对应: Q-6
verdict: PASS
第 2 次运行（同命令重跑，结果与第 1 次一致，无 FLAKY）。
```command
set -e; B=http://localhost:5300/api/brain/strategic-decisions; S="$(date +%s)-$RANDOM"; T="QA-cat-dup-$S"; for n in 1 2; do C=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); echo "valid#$n code=$C"; test "$C" = 201; done; TB="QA-cat-dupbad-$S"; B1=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); B2=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}"); echo "bad#1 code=$(echo "$B1"|tail -1) bad#2 code=$(echo "$B2"|tail -1)"; test "$(echo "$B1"|tail -1)" = 400; test "$B1" = "$B2"; curl -s "$B?category=decision&limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==2'; curl -s "$B?limit=200" | jq -e --arg t "$TB" '[.data[]|select(.topic==$t)]|length==0'; echo "Q-6 OK suffix=$S"
```
```output
valid#1 code=201
valid#2 code=201
bad#1 code=400 bad#2 code=400
true
true
Q-6 OK suffix=1791623476-9504
```

### T-9
对应: Q-8
verdict: PASS
用预览环境打包的 Dashboard（`http://localhost:5300/knowledge/decisions`，同源连预览 Brain；每个子场景独立 `browser.newContext()`）。分类留空 → 201、弹窗关闭、列表出现该主题且分类标签为 decision；分类填 product → 400、弹窗不关、弹窗内红字列出 decision/judgment 等合法值、按钮复位为“记录”，取消并刷新后列表无该主题。
截图: qa-r2/q8-default-ok.png、qa-r2/q8-bad-error.png、qa-r2/q8-bad-list.png
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6220-2 && node - <<'EOF'
const { chromium } = require('playwright');
const SHOTS = 'sprints/10101539-cw-4ea44bcf/qa-r2';
const BASE = 'http://localhost:5300';
const S = `${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
const tGood = `QA-ui-default-${S}`, tBad = `QA-ui-bad-${S}`;
function fail(m) { console.log('FAIL:', m); process.exitCode = 1; }
async function openModal(page) {
  await page.goto(`${BASE}/knowledge/decisions`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '记录决策' }).click();
  await page.getByPlaceholder('决策主题').waitFor();
}
const isPost = r => r.url().includes('/api/brain/strategic-decisions') && r.request().method() === 'POST';
(async () => {
  const browser = await chromium.launch();
  { // 分类留空
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await openModal(page);
    await page.getByPlaceholder('决策主题').fill(tGood);
    await page.getByPlaceholder('具体的决策内容').fill('QA 分类留空');
    const rp = page.waitForResponse(isPost);
    await page.getByRole('button', { name: '记录', exact: true }).click();
    const resp = await rp;
    console.log('default POST status', resp.status(), 'category', (await resp.json()).data?.category);
    await page.getByPlaceholder('决策主题').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('弹窗未关闭'));
    const card = page.locator('div.border.rounded-lg', { hasText: tGood }).first();
    await card.waitFor({ timeout: 10000 }).catch(() => fail('列表未出现主题'));
    const txt = (await card.innerText().catch(() => '')).replace(/\n/g, ' | ');
    console.log('card text:', txt);
    if (!/\bdecision\b/.test(txt)) fail('卡片分类不是 decision');
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${SHOTS}/q8-default-ok.png`, fullPage: true });
    await ctx.close();
  }
  { // 分类 product
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await openModal(page);
    await page.getByPlaceholder('决策主题').fill(tBad);
    await page.getByPlaceholder('具体的决策内容').fill('QA 非法分类');
    await page.getByPlaceholder('留空即 decision').fill('product');
    const rp = page.waitForResponse(isPost);
    await page.getByRole('button', { name: '记录', exact: true }).click();
    console.log('bad POST status', (await rp).status());
    const err = page.locator('p.text-red-500');
    await err.waitFor({ timeout: 5000 }).catch(() => fail('弹窗内无错误文字'));
    const et = await err.innerText().catch(() => '');
    console.log('modal error:', et);
    if (!(et.includes('decision') && et.includes('judgment'))) fail('错误文字未列出合法值');
    console.log('modal still open:', await page.getByPlaceholder('决策主题').isVisible());
    if (!(await page.getByPlaceholder('决策主题').isVisible())) fail('弹窗被关闭');
    console.log('button text after fail:', await page.getByRole('button', { name: '记录', exact: true }).innerText());
    await page.screenshot({ path: `${SHOTS}/q8-bad-error.png`, fullPage: true });
    await page.getByRole('button', { name: '取消' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    const n = await page.locator('div.border.rounded-lg', { hasText: tBad }).count();
    console.log('bad topic cards in list:', n);
    if (n !== 0) fail('列表出现非法主题');
    await page.screenshot({ path: `${SHOTS}/q8-bad-list.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log(process.exitCode ? 'Q-8 FAIL' : `Q-8 OK suffix=${S}`);
})();
EOF
```
```output
default POST status 201 category decision
card text: 活跃 | decision |  | QA-ui-default-1791623504186-55161 |  | QA 分类留空 |  | 2026/10/9 |  | 活跃 | 已执行 | 已过期
bad POST status 400
modal error: category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing
modal still open: true
button text after fail: 记录
bad topic cards in list: 0
Q-8 OK suffix=1791623504186-55161
```

### X-1
对应: I-1
verdict: PASS
探索：空 body、缺 decision 时报必填（先于 category 校验，说人话）；category 为对象 → 400；GET 查不存在的 category → 200 空数组。
```command
B=http://localhost:5300/api/brain/strategic-decisions; echo '--- empty body'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{}'; echo '--- broken json'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":' | head -c 400; echo; echo '--- bogus category + missing decision'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":"QA-x","category":"zzz"}'; echo '--- category object'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":"QA-obj","decision":"d","category":{"a":1}}' | head -c 120; echo; echo '--- GET nonexistent category'; curl -s -w '\n%{http_code}\n' "$B?category=nope_xyz&limit=5"
```
```output
--- empty body
{"success":false,"error":"topic 和 decision 为必填项"}
400
--- broken json
{"success":false,"error":"Unexpected end of JSON input"}
500

--- bogus category + missing decision
{"success":false,"error":"topic 和 decision 为必填项"}
400
--- category object
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infr
--- GET nonexistent category
{"success":true,"data":[],"total":0}
200
```

### X-2
对应: I-1
严重度: 建议
场景: 调用方发送截断的 JSON（`{"topic":`），收到 HTTP 500 + 解析器原文 `Unexpected end of JSON input`。这是请求体解析层（全局中间件）的行为，不属于本单 category 校验范围，也未透出数据库/SQL 原文；但按“输入错应 400”的语义，归类为体验瑕疵，建议另立单处理。
verdict: FAIL
```command
B=http://localhost:5300/api/brain/strategic-decisions; echo '--- empty body'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{}'; echo '--- broken json'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":' | head -c 400; echo; echo '--- bogus category + missing decision'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":"QA-x","category":"zzz"}'; echo '--- category object'; curl -s -w '\n%{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"topic":"QA-obj","decision":"d","category":{"a":1}}' | head -c 120; echo; echo '--- GET nonexistent category'; curl -s -w '\n%{http_code}\n' "$B?category=nope_xyz&limit=5"
```
```output
--- broken json
{"success":false,"error":"Unexpected end of JSON input"}
500
```

### X-3
对应: I-3
严重度: 建议
场景: 本机 UTC 09:11 写入的记录，预览库返回 `created_at` 为 `2026-10-10T04:11:45Z`（比真实时间早 5 小时），Dashboard 卡片因此显示日期 `2026/10/9`。疑为预览库/连接时区配置的既有问题，与本单改动无关，不影响 I-3 的写入与查询，记录备查。
verdict: FAIL
```command
curl -s 'http://localhost:5300/api/brain/strategic-decisions?category=decision&limit=3' | jq -c '.data[]|{topic,created_at,decided_at}'; date -u
```
```output
{"topic":"QA-ui-default-1791623504186-55161","created_at":"2026-10-10T04:11:45.505Z","decided_at":null}
{"topic":"QA-cat-dup-1791623476-9504","created_at":"2026-10-10T04:11:16.518Z","decided_at":null}
{"topic":"QA-cat-dup-1791623476-9504","created_at":"2026-10-10T04:11:16.510Z","decided_at":null}
Sat Oct 10 09:11:53 UTC 2026
```
