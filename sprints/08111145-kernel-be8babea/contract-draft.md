# Sprint Contract Draft (Round 1 — 只读复验)

## Response Schema（推导来源: PRD 字面）

N/A — 本轮不新增 HTTP API、不生成或修改代码，只复验已批准 PR #4794 的精确 head `f8fd3adae68195998198ad38a9c34c050fcab8c7`。

## 已知约束

- [thin_prd] 七条 `required_command_evidence` 必须严格串行、原样执行；七条全部 exit 0 且 `log_tail` 非空才可 PASS。
- [thin_prd] LOCAL/US/HK 三地的 `build-info.json`、`/`、`sw.js`、`/workbench/tasks` 必须逐字一致。
- [thin_prd] WebKit 必须使用 fresh private context，等待 10 秒并刷新后仍保持深链。
- [thin_prd] Fleet evaluator 没有 HK SSH 私钥；Controller 已只读核对 access log，禁止把该基础设施边界误判为页面失败。
- [累积FR] 本轮绑定已批准原始 Sprint 合同；不扩展实现范围。

gp-anchor: skipped (product-map.json not found)

## Golden Path

覆盖父路“Dashboard HK/US 官方发布主链”第 3-4 步

Evaluator 锁定 PR #4794 精确 head → 串行运行五组永久回归 → 三地四资源逐字对账 → WebKit 私密深链等待与刷新复验 → 独立 Judge 核对七条证据。

### Step 1: 五组永久回归全部通过
**来源**: `[FROM_PRD]` — thin_prd 明列 required_command_evidence 第 1-5 条。

**可观测行为**: 五条既有回归命令按给定顺序执行，均 exit 0 且各自输出非空。

**验证命令**: 见 `## E2E 验收` 第 1-5 条，命令字面不得改写。

**硬阈值**: 5/5 exit 0，5/5 log_tail 非空；任一失败立即 FAIL。

### Step 2: LOCAL/US/HK 三地四资源精确一致
**来源**: `[FROM_PRD]` — thin_prd 明列 required_command_evidence 第 6 条。

**可观测行为**: 三地 `build-info.json` 均自报冻结 SHA，四类资源逐字相同，无旧 PWA 注册语句。

**验证命令**: 见 `## E2E 验收` 第 6 条，命令字面不得改写。

**硬阈值**: 3/3 SHA 精确等于冻结 head；8 次 `cmp` 全部 exit 0；两个负向 PWA 断言均通过。

### Step 3: WebKit 私密深链等待与刷新保持
**来源**: `[FROM_PRD]` — thin_prd 明列 required_command_evidence 第 7 条。

**可观测行为**: fresh WebKit context 打开 HK 深链，首次、等待 10 秒后、刷新再等待 10 秒后 pathname 均为 `/workbench/tasks`，service worker 注册数为 0。

**验证命令**: 见 `## E2E 验收` 第 7 条，命令字面不得改写。

**硬阈值**: HTTP 200；三个 pathname 全相等；registrations=0；命令 exit 0 且 JSON log_tail 非空。

### Step 4: 独立 Judge 逐条核证
**来源**: `[FROM_PRD]` — thin_prd 明确 Evaluator PASS 后必须进入独立 Judge。

**可观测行为**: Judge 收到七条精确命令的 exit code 与非空 log_tail，逐条核对后裁决。

**验证命令**: Kernel 检查 `checks` 数组恰为七项，每项 `exit_code=0` 且 `log_tail` 非空；Judge 引用同一证据摘要。

**硬阈值**: 7/7 证据齐全；禁止仅凭聚合“测试通过”判 PASS。

## 真实调用方请求 shape

- 浏览器：WebKit fresh context 对 `GET http://100.86.118.99:5211/workbench/tasks` 发普通导航请求，不注入 cookie、authorization 或 token。
- 静态对账：对 LOCAL/US/HK 原样 GET `/build-info.json`、`/`、`/sw.js`、`/workbench/tasks`。

## 禁 mock 边清单

- curl ↔ LOCAL/US/HK 三个真实 5211 入口（禁止代理为 fixture）。
- Playwright WebKit ↔ HK 真实深链（禁止 `page.route()`、storageState 或复用 context）。

## 接缝清单

- 三地生产静态资源：第 6 条在真实目标重复读取并精确对账，标 `[接缝×2]`。
- WebKit/HK 深链：第 7 条 fresh context、等待、刷新真验，标 `[接缝×2]`。
- HK access log 已由 Controller 在本轮 WebKit 请求后只读核对；Evaluator 无 HK SSH 私钥是已声明基础设施边界，不新增第八条命令。

## 未覆盖真实链路清单

- HK access log 只读核对由 Controller 持有证据；Fleet evaluator 无 HK SSH 私钥。此项不替代七条 required evidence，也不得作为页面失败理由。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | 只读复验精确 PR head 的五组回归、三地资源和 WebKit 深链。 |
| NFR（做得多好） | 可靠性 | 七条严格串行；全部 exit 0 且 log_tail 非空。 |
| Invariant（永不违反） | 不变量 | 不修改代码；不替换命令；不把 HK SSH 边界误判为页面失败。 |
| 判定点（怎么知道） | 判断方法 | 见登记表。 |
| 保质期（何时过期） | 能力失效 | 证据只绑定 frozen SHA 与本次 run。 |
| 死亡告警（停了谁知道） | 告警 | 任一命令非零由 Evaluator 当场 FAIL 并交 Kernel。 |
| 失败语义（挂了怎么办） | 故障策略 | fail closed；无 skip、无降级、无命令替换。 |
| 效果确认（已发≠已生效） | 回执 | 精确资源字节、页面 pathname 与 service worker 数量。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 三地是否同一产物 | HTTP 200；SHA；逐字对账 | SHA + 四资源逐字对账 | thin_prd 精确指定 | 旧产物面客 |
| WebKit 深链是否稳定 | 首屏；等待；刷新 | fresh context + 10s + reload + 10s | thin_prd 精确指定 | Safari 回主页漏检 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 任一 required command 非零 | Evaluator FAIL | 只读命令可复跑 | 无 |
| 任一 log_tail 为空 | 证据不完整，FAIL | 可复跑 | 不用汇总话术替代 |
| HK SSH 不可用 | 不执行额外 SSH；按七条合同裁决 | N/A | 采用 Controller 已核对的边界说明，不改页面结论 |

### 输入对抗面

N/A — 本轮无对外 agent 或用户输入接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: build-info SHA 缺失或大小写变化不得通过。
- 重复提交: 第 6、7 条重复执行结果应一致。
- 中途中断: 任一命令中断不得继续聚合为 PASS。
- 边界值: deep route 返回根页相同 HTML 但 pathname 改变时必须 FAIL。
发现分级: P0/P1 阻塞；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/usr/bin/env bash
set -euo pipefail
bash packages/quality/scripts/dashboard-only-production-chain.test.sh
bash scripts/smoke/dashboard-staging-gate-smoke.sh
bash scripts/smoke/deploy-chain-wounds-smoke.sh
npx vitest run tests/regression/dashboard-only-staging-contract.test.ts
cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js
cd ../..
bash -c 'set -euo pipefail; SHA=f8fd3adae68195998198ad38a9c34c050fcab8c7; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; LOCAL=http://host.docker.internal:5211; US=http://100.71.151.105:5211; HK=http://100.86.118.99:5211; for N in LOCAL US HK; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; jq -e --arg sha "$SHA" '\''.git_sha==$sha'\'' "$T/$N.build" >/dev/null; done; cmp "$T/LOCAL.build" "$T/US.build"; cmp "$T/US.build" "$T/HK.build"; cmp "$T/LOCAL.index" "$T/US.index"; cmp "$T/US.index" "$T/HK.index"; cmp "$T/LOCAL.sw" "$T/US.sw"; cmp "$T/US.sw" "$T/HK.sw"; cmp "$T/LOCAL.deep" "$T/US.deep"; cmp "$T/US.deep" "$T/HK.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"; echo "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK $SHA"'
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e 'const { webkit } = require("/usr/local/lib/node_modules/playwright"); (async()=>{const browser=await webkit.launch({headless:true}); const context=await browser.newContext(); const page=await context.newPage(); const url="http://100.86.118.99:5211/workbench/tasks"; const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const first=new URL(page.url()).pathname; const afterWait=new URL(page.url()).pathname; await page.reload({waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const second=new URL(page.url()).pathname; const registrations=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0); console.log(JSON.stringify({status:response.status(),first,afterWait,second,registrations,url:page.url()})); await browser.close(); if(response.status()!==200||first!=="/workbench/tasks"||afterWait!=="/workbench/tasks"||second!=="/workbench/tasks"||registrations!==0)process.exit(1)})().catch(error=>{console.error(error);process.exit(1)})'
```

> 执行器必须把上面七条业务命令分别记录为七项证据；`cd ../..` 仅恢复第 5 条后的工作目录，不计第八条证据。

## staging 预览闸

本轮是已批准生产 head 的只读复验，不重新部署 staging。沿用原合同已完成的 Cecelia 通知式预览闸；禁止因 recurrence 产生新 promote。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 既有发布主链 | `packages/quality/scripts/dashboard-only-production-chain.test.sh` | `Dashboard-only production chain` | 既有永久回归，当前应绿 |
| WebKit 深链 | required evidence 第 7 条 | `fresh private context 等待与刷新保持` | 生产回退时命令非零 |
