# Sprint Contract Draft (Round 2)

## 修订案卷

- R1-1 已关闭：INV-1 改为读取 Evaluator 结构化结果的 `checks`（兼容 `behavior_tests`）并与 TaskBundle 的七条 `required_command_evidence` 逐字对账；每条必须同时满足 `exit_code === 0` 与非空 `log_tail`，不再 grep 合同自身。

## Response Schema（推导来源: PRD 字面）

N/A — 本轮是冻结 PR #4794 的只读复验，不新增或修改 API、代码、测试或部署资源。

## 已知约束

- 冻结对象：PR #4794，精确 head `f8fd3adae68195998198ad38a9c34c050fcab8c7`。
- 本轮绑定已批准原始 Sprint 合同 `sprints/08111145-kernel-be8babea`，只复验，不生成或修改产品代码。
- Evaluator 必须严格串行、原样运行 TaskBundle 中七条 `required_command_evidence`；七条均 `exit_code=0` 且 `log_tail` 非空才可 PASS。
- Controller 已只读核对 HK access log：静态资源请求 Referer 为 `http://100.86.118.99:5211/workbench/tasks`，未出现 cookie/authorization/token 字段。Fleet 无 HK SSH 私钥是已登记基础设施边界，不得改写成页面失败。
- Unified Map：`[MAP_NOT_CONFIGURED]`；task payload 未提供 map_scope/map_repo，禁止领域硬编码回退。
- context-manifest: unavailable；沿用 PRD 已知约束。

gp-anchor: skipped (product-map.json not found)

## Golden Path

覆盖父路「Dashboard HK/US 官方发布主链」第 2-4 步（只读复验）

读取冻结 PR head → 串行运行五组永久回归 → LOCAL/US/HK 三地四资源逐字对账 → WebKit fresh private context 等待 10 秒并刷新后保持深链 → 结构化证据交独立 Judge。

### Step 1: 五组永久回归原样复验
**来源**: `[FROM_PRD]` — thin PRD 的 required_command_evidence 第 1-5 条。

**可观测行为**: 五条命令按给定顺序执行，每条都产生真实退出码和非空日志。

**验证命令**: 见 `## E2E 验收` 中第 1-5 条原样命令。

**硬阈值**: 5/5 的 `exit_code=0` 且 `log_tail` 去空白后非空；任一失败立即 FAIL。

### Step 2: LOCAL/US/HK 三地四资源精确对账
**来源**: `[FROM_PRD]` — thin PRD 的 required_command_evidence 第 6 条。

**可观测行为**: 三地 `build-info.json`、首页、`sw.js`、`/workbench/tasks` 逐字一致，三地 SHA 精确等于冻结 head，旧 PWA 注册语义不存在。

**验证命令**: 见 `## E2E 验收` 中第 6 条原样命令。

**硬阈值**: 12 个请求均在 15 秒内成功；全部 `cmp` 为 0；三份 `.git_sha` 精确等于冻结 SHA。

### Step 3: WebKit fresh private context 深链保持
**来源**: `[FROM_PRD]` — thin PRD 的 required_command_evidence 第 7 条。

**可观测行为**: 真实 Playwright WebKit 新 context 打开 HK 深链，等待 10 秒、刷新并再等待 10 秒后 pathname 始终不变，service worker 注册数为 0。

**验证命令**: 见 `## E2E 验收` 中第 7 条原样命令。

**硬阈值**: HTTP 200；`first`、`afterWait`、`second` 均为 `/workbench/tasks`；`registrations=0`；命令 exit 0 且日志非空。

### Step 4: 独立 Judge 精确核对七条证据
**来源**: `[FROM_PRD]` — thin PRD 明确要求 Evaluator PASS 后进入独立 Judge。

**可观测行为**: Judge 读取 Evaluator 的结构化 `checks`，逐字匹配七条命令，并同时核对退出码与日志；摘要、相似命令、空日志均不能替代。

**验证命令**:
```bash
node -e 'const fs=require("fs");(async()=>{const bundle=JSON.parse(fs.readFileSync(process.env.TASK_BUNDLE_PATH,"utf8"));const result=JSON.parse(fs.readFileSync(process.env.EVALUATOR_RESULT_PATH,"utf8"));const checks=result.checks??result.behavior_tests;const {reconcileRequiredCommandEvidence}=await import("./packages/brain/src/orchestrator/required-command-evidence.js");const r=reconcileRequiredCommandEvidence(bundle.inputs.required_command_evidence,checks);if(!r.valid||!r.complete)throw new Error(JSON.stringify(r));console.log("SEVEN_REQUIRED_COMMAND_EVIDENCE_OK")})().catch(e=>{console.error(e);process.exit(1)})'
```

**硬阈值**: `valid=true`、`complete=true`、`missing=[]`；Judge 与 Evaluator 必须使用各自 Runner late-bound 身份。

## 真实调用方请求 shape

- 浏览器：Playwright WebKit `GET http://100.86.118.99:5211/workbench/tasks`，全新 context，不注入 cookie、authorization 或 token。
- 静态对账：对 LOCAL/US/HK 原样 `GET /build-info.json`、`GET /`、`GET /sw.js`、`GET /workbench/tasks`。

## 禁 mock 边清单

- required_command_evidence ↔ Evaluator `checks`：必须逐字匹配真实执行证据，禁止静态合同自证。
- Playwright WebKit ↔ HK 5211：禁止 `page.route()`、fixture 或其他浏览器替代。
- LOCAL/US/HK ↔ 四类资源：禁止缓存文件或历史输出替代本轮 curl。

## 接缝清单

- 三地 5211 网络与资源一致性：第 6 条在真实目标执行，未通过前为 `logic-done-pending`。
- HK WebKit 深链：第 7 条在真实目标执行，未通过前为 `logic-done-pending`；标记 `[接缝×2]`，Evaluator 重复两次，不一致判 FLAKY。
- HK access log 只读补证由 Controller 完成；Fleet 无 HK SSH 私钥是证据采集边界，不改变第 7 条页面判定。

## 未覆盖真实链路清单

- Fleet Evaluator 不持有 HK SSH 私钥，入口 access log 由 Controller 在本轮 WebKit 请求后只读核对；页面成功与否仍只由第 7 条 WebKit 命令裁定，不因该基础设施边界失败。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 只读复验冻结 PR head 的七条精确命令证据。 |
| NFR（做得多好） | 严格串行；七条全部 exit 0 且 log_tail 非空。 |
| Invariant（永不违反） | 不修改代码/部署；不以摘要或相似命令替代；凭据不入日志。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 证据只绑定本 run、冻结 SHA 与当前 Runner 身份。 |
| 死亡告警（停了谁知道） | 任一命令非零、空日志或缺证据即 Evaluator/Judge fail closed。 |
| 失败语义（挂了怎么办） | 不降级、不跳过、不把 SSH 边界误判为页面失败。 |
| 效果确认（已发≠已生效） | 三地逐字对账 + WebKit 等待刷新 + Judge 结构化复核。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 三地是否精确同版 | HTTP 200；SHA；四资源逐字比较 | SHA + 四资源逐字比较 | thin PRD 明确指定 | 旧资源继续面客 |
| ⚠️ WebKit 深链是否稳定 | 首次路径；等待；刷新 | fresh context + 10s 等待 + 刷新 + 10s 等待 | thin PRD 明确指定 | Safari 用户跳回首页 |
| 七条证据是否完整 | 文本声明；结构化 checks | 命令逐字、exit 0、非空 log_tail 三重核对 | Kernel 证据合同 | 假绿放行 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| required 命令非零或日志为空 | Evaluator FAIL | 可在同一冻结对象上复验 | 无 |
| 三地不一致/不可达 | Evaluator FAIL | 网络恢复后复验 | 无缓存替代 |
| WebKit 路径变化 | Evaluator FAIL | fresh context 可复验 | 无 Chromium 替代 |
| HK SSH 私钥缺失 | 记录已知基础设施边界 | N/A | Controller 只读 access log 补证；不改变页面判定 |

### 输入对抗面

N/A — 本轮不新增对外 agent 或用户输入面。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `build-info.json.git_sha` 缺失或非冻结 SHA 必须失败。
- 重复提交: 第 7 条用第二个 fresh context 重跑，结果必须一致。
- 中途中断: 任一命令失败后不得继续汇总为 PASS。
- 边界值: 空 `log_tail`、近似但非逐字命令、历史日志均不得算证据。
发现分级: P0/P1 阻塞；P2/P3 记 findings。

## E2E 验收（严格串行原样执行）

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

执行器必须把上述七条命令分别记录为七个 `checks`，不得把整块聚合成一条；每项写入精确 `command`、真实 `exit_code`、非空 `log_tail` 和对应 `verification_level`。第 1-5 条为 L2，第 6-7 条为 L3；第 7 条重复两次判 FLAKY，但 required evidence 仍以原命令记录一次成功证据。

## staging 预览闸

本轮只读复验既有生产部署，不再次落 staging、不触发 Bark 或 promote。原 PR #4794 的 staging 预览闸证据属于已批准合同；本轮禁止产生外部写入。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| recurrence 证据完整性 | Kernel 内置 `required-command-evidence.js` | `七条命令逐字匹配且 exit 0、log_tail 非空` | 缺任一 checks 项、命令不逐字、非零或空日志即 FAIL |

本轮为只读验收 recurrence，`test_is_red` 不适用；不新增、不修改测试文件，保留原 Sprint 永久回归。
