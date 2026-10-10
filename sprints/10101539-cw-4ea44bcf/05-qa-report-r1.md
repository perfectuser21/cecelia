---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-7", "02-spec.md#Q-8", "02-spec.md#Q-6"]
---
# QA 报告（第 1 轮，环境 http://localhost:5300）

本轮开始时间：2026-10-10T08:34:48Z。所有断言只针对本轮请求生成的带纳秒时间戳的 topic。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; T="QA-cat-bogus-$(date +%s%N)"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$T\",\"decision\":\"非法类别探针\"}"); echo "$R"; [ "$(echo "$R" | tail -1)" = 400 ] && echo "$R" | head -1 | jq -e '.success==false and (.allowed_categories|length==13) and (.allowed_categories|index("decision")!=null and index("judgment")!=null and index("testing")!=null) and (.error|test("decision") and test("judgment"))' && ! echo "$R" | grep -Eiq 'decisions_category_chk|violates|relation|check constraint' && curl -s "$B?limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==0' && echo Q1_OK
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
400
true
true
Q1_OK
```

### T-2
对应: Q-2
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; S=$(date +%s%N); LONG=$(printf 'a%.0s' $(seq 1 10000)); FAIL=0; for C in '"Decision"' '1' '["decision"]' "\"$LONG\""; do T="QA-cat-adv-$S-$RANDOM"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":$C,\"topic\":\"$T\",\"decision\":\"对抗探针\"}"); CODE=$(echo "$R" | tail -1); echo "$CODE $(echo "$R" | head -1 | cut -c1-160)"; [ "$CODE" = 400 ] && echo "$R" | head -1 | jq -e '.success==false and (.allowed_categories|length==13)' >/dev/null && ! echo "$R" | grep -Eiq 'decisions_category_chk|violates|relation|check constraint|value too long' && curl -s "$B?limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==0' >/dev/null || FAIL=1; done; [ $FAIL = 0 ] && echo Q2_OK
```
```output
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testin
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testin
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testin
400 {"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testin
Q2_OK
```

### T-3
对应: Q-3
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; S=$(date +%s%N); FAIL=0; i=0; for C in NONE '""' 'null'; do i=$((i+1)); T="QA-cat-default-$S-$i"; if [ "$C" = NONE ]; then BODY="{\"topic\":\"$T\",\"decision\":\"不带类别\"}"; else BODY="{\"category\":$C,\"topic\":\"$T\",\"decision\":\"不带类别\"}"; fi; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "$BODY"); CODE=$(echo "$R" | tail -1); echo "$CODE $(echo "$R" | head -1 | jq -c '{c:.data.category,id:.data.id,t:.data.topic}')"; [ "$CODE" = 201 ] && echo "$R" | head -1 | jq -e '.data.category=="decision" and (.data.id|length>0)' >/dev/null && curl -s "$B?category=decision&limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t and .category=="decision")]|length==1' >/dev/null || FAIL=1; done; [ $FAIL = 0 ] && echo Q3_OK
```
```output
201 {"c":"decision","id":"4bcdf6b0-20eb-425e-93c3-509da69704c7","t":"QA-cat-default-1791621320904014000-1"}
201 {"c":"decision","id":"c324e4ca-4fb6-4a78-8a7d-334623829c55","t":"QA-cat-default-1791621320904014000-2"}
201 {"c":"decision","id":"22fc76f5-2cd7-42c6-b7c0-f67998bcfdf6","t":"QA-cat-default-1791621320904014000-3"}
Q3_OK
```
说明：三次分别为不带 category、`""`、`null`。

### T-4
对应: Q-4
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; T="QA-cat-valid-$(date +%s%N)"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"合法类别\"}"); echo "$R" | tail -1; echo "$R" | head -1 | jq -c '{success,c:.data.category,t:.data.topic}'; [ "$(echo "$R" | tail -1)" = 201 ] && echo "$R" | head -1 | jq -e '.data.category=="decision"' >/dev/null && G=$(curl -s -w '\n%{http_code}' "$B?category=decision&limit=200") && [ "$(echo "$G" | tail -1)" = 200 ] && echo "$G" | head -1 | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].category=="decision" and $m[0].status=="active"' && echo Q4_OK
```
```output
201
{"success":true,"c":"decision","t":"QA-cat-valid-1791621303863778000"}
true
Q4_OK
```

### T-5
对应: Q-5
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; T="判定点[qa000000#1]: QA-$(date +%s%N)"; R=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"$T\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"system\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:qa\"}"); echo "$R" | tail -1; [ "$(echo "$R" | tail -1)" = 201 ] && curl -s "$B?category=judgment&limit=1000" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)] as $m | ($m|length==1) and $m[0].made_by=="system" and $m[0].author=="coding-workflow"' && echo Q5_OK
```
```output
201
true
Q5_OK
```

### T-6
对应: Q-7
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; S=$(date +%s%N); T1="QA-madeby-$S"; T2="QA-prio-$S"; R1=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"judgment\",\"topic\":\"$T1\",\"decision\":\"旧 shape 探针\",\"made_by\":\"ai\"}"); R2=$(curl -s -w '\n%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"topic\":\"$T2\",\"decision\":\"优先级探针\",\"priority\":\"P9\"}"); echo "$R1"; echo "$R2"; [ "$(echo "$R1" | tail -1)" = 400 ] && [ "$(echo "$R2" | tail -1)" = 400 ] && echo "$R1" | head -1 | jq -e '.allowed_made_by==["user","cecelia","system"]' && echo "$R2" | head -1 | jq -e '.allowed_priorities==["P0","P1","P2","P3"]' && ! printf '%s%s' "$R1" "$R2" | grep -Eiq 'check constraint|violates' && curl -s "$B?limit=200" | jq -e --arg a "$T1" --arg b "$T2" '[.data[]|select(.topic==$a or .topic==$b)]|length==0' && echo Q7_OK
```
```output
{"success":false,"error":"made_by 非法，合法值：user|cecelia|system","allowed_made_by":["user","cecelia","system"]}
400
{"success":false,"error":"priority 非法，合法值：P0|P1|P2|P3","allowed_priorities":["P0","P1","P2","P3"]}
400
true
true
true
Q7_OK
```

### T-7
对应: Q-8
verdict: PASS
说明：Dashboard 用预览环境自带打包页面 http://localhost:5300/knowledge/decisions（不走 localhost:5174，避免其代理连到生产 Brain）。两个场景各用一个全新的 `browser.newContext()`。
截图: qa-r1/q8-a-default-category.png
截图: qa-r1/q8-b-bad-category.png
```command
node - <<'EOF'
const { chromium } = require('/Users/administrator/worktrees/cecelia-cw/qa-6220-1/node_modules/playwright');
const BASE = 'http://localhost:5300';
const SHOTS = '/Users/administrator/worktrees/cecelia-cw/qa-6220-1/sprints/10101539-cw-4ea44bcf/qa-r1';
const S = Date.now();
const assert = (c, m) => { if (!c) { console.log('ASSERT_FAIL: ' + m); process.exitCode = 1; } else console.log('ok: ' + m); };
async function openModal(page) {
  await page.goto(BASE + '/knowledge/decisions', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '记录决策' }).first().click();
  await page.getByRole('heading', { name: '记录决策' }).waitFor();
}
(async () => {
  const browser = await chromium.launch();
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const topic = `QA-ui-default-${S}`;
    await openModal(page);
    await page.getByPlaceholder('决策主题').fill(topic);
    await page.getByPlaceholder('具体的决策内容').fill('UI 分类留空探针');
    const respP = page.waitForResponse(r => r.url().includes('/api/brain/strategic-decisions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '记录', exact: true }).click();
    const resp = await respP;
    console.log('A POST status', resp.status(), 'category', (await resp.json()).data?.category);
    await page.waitForTimeout(1500);
    assert(await page.getByRole('heading', { name: '记录决策' }).count() === 0, 'A 弹窗已关闭');
    await page.getByText(topic).first().waitFor({ timeout: 10000 }).catch(() => {});
    assert(await page.getByText(topic).count() > 0, 'A 列表出现该主题');
    const rowText = await page.getByText(topic).first().locator('xpath=ancestor::*[contains(., "decision")][1]').innerText().catch(() => '');
    console.log('A 行文本:', rowText.replace(/\s+/g, ' ').slice(0, 160));
    assert(/decision/.test(rowText), 'A 该条分类显示 decision');
    await page.screenshot({ path: `${SHOTS}/q8-a-default-category.png`, fullPage: true });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const topic = `QA-ui-bad-${S}`;
    await openModal(page);
    await page.getByPlaceholder('决策主题').fill(topic);
    await page.getByPlaceholder('具体的决策内容').fill('UI 非法分类探针');
    await page.getByPlaceholder('留空即 decision').fill('product');
    const respP = page.waitForResponse(r => r.url().includes('/api/brain/strategic-decisions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '记录', exact: true }).click();
    const resp = await respP;
    console.log('B POST status', resp.status());
    await page.waitForTimeout(1000);
    assert(await page.getByRole('heading', { name: '记录决策' }).count() === 1, 'B 弹窗仍打开');
    const err = await page.locator('p.text-red-500').innerText().catch(() => '');
    console.log('B 弹窗错误文字:', err);
    assert(/decision/.test(err) && /judgment/.test(err), 'B 错误文字列出 decision、judgment');
    await page.screenshot({ path: `${SHOTS}/q8-b-bad-category.png`, fullPage: true });
    const list = await (await fetch(`${BASE}/api/brain/strategic-decisions?limit=200`)).json();
    assert(!list.data.some(d => d.topic === topic), 'B 该主题未写入库');
    await ctx.close();
  }
  await browser.close();
})();
EOF
ls sprints/10101539-cw-4ea44bcf/qa-r1
```
```output
A POST status 201 category decision
ok: A 弹窗已关闭
ok: A 列表出现该主题
A 行文本: 活跃 decision QA-ui-default-1791621360146 UI 分类留空探针 2026/10/9
ok: A 该条分类显示 decision
B POST status 400
ok: B 弹窗仍打开
B 弹窗错误文字: category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing
ok: B 错误文字列出 decision、judgment
ok: B 该主题未写入库
q8-a-default-category.png
q8-b-bad-category.png
```

### T-8
对应: Q-6
verdict: PASS
```command
B=http://localhost:5300/api/brain/strategic-decisions; T="QA-cat-dup-$(date +%s%N)"; C1=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B -H 'content-type: application/json' -d "{\"category\":\"decision\",\"topic\":\"$T\",\"decision\":\"重复提交\"}"); TB="$T-bogus"; B1=$(curl -s -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}" -w '|%{http_code}'); B2=$(curl -s -X POST $B -H 'content-type: application/json' -d "{\"category\":\"workflow_bogus\",\"topic\":\"$TB\",\"decision\":\"重复非法\"}" -w '|%{http_code}'); echo "valid: $C1 $C2"; echo "bogus1: ${B1: -4}"; echo "bogus2: ${B2: -4}"; [ "$C1" = 201 ] && [ "$C2" = 201 ] && [ "${B1##*|}" = 400 ] && [ "$B1" = "$B2" ] && curl -s "$B?category=decision&limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==2' && curl -s "$B?limit=200" | jq -e --arg t "$TB" '[.data[]|select(.topic==$t)]|length==0' && echo Q6_OK
```
```output
valid: 201 201
bogus1: |400
bogus2: |400
true
true
Q6_OK
```
说明：两次非法请求的完整响应（含状态码）用 `[ "$B1" = "$B2" ]` 断言逐字相同。

### X-1
对应: I-1
verdict: PASS
场景: 用户把 category 写成带前导空格的 ` decision`，以及漏填 topic/decision 必填项
```command
B=http://localhost:5300/api/brain/strategic-decisions; T="QA-sp-$(date +%s%N)"; curl -s -w ' %{http_code}\n' -X POST $B -H 'content-type: application/json' -d "{\"category\":\" decision\",\"topic\":\"$T\",\"decision\":\"空格探针\"}" | cut -c1-80; curl -s -w ' %{http_code}\n' -X POST $B -H 'content-type: application/json' -d '{"category":"decision"}'; curl -s "$B?limit=200" | jq -e --arg t "$T" '[.data[]|select(.topic==$t)]|length==0'
```
```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployme
{"success":false,"error":"topic 和 decision 为必填项"} 400
true
```
说明：带空格值被拒并给出合法值、未写库；缺必填项返回 400 且提示是人话。

### X-2
对应: I-1
严重度: 建议
场景: 调用方发出畸形 JSON 请求体（本轮第一次跑 Q-3 时 topic 里误含引号即触发），接口返回 HTTP 500，error 是 JSON 解析器英文原文，没有说明是请求体格式错误；应为 400 + 人话提示。不含数据库约束原文，且属于全局 body 解析层行为，不影响本需求 I-1~I-3 的验收。
verdict: FAIL
```command
curl -s -w '\n%{http_code}\n' -X POST http://localhost:5300/api/brain/strategic-decisions -H 'content-type: application/json' -d '{"category":"x","topic":"QA-badjson-"1"}'
```
```output
{"success":false,"error":"Expected ',' or '}' after property value in JSON at position 37 (line 1 column 38)"}
500
```
