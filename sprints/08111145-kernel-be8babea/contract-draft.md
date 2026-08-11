# Sprint Contract Draft (Round 3)

## 合同性质与冻结对象

本轮是只读复验，不生成或修改产品代码。冻结对象为 PR #4794、候选 SHA `f8fd3adae68195998198ad38a9c34c050fcab8c7`，并绑定已批准 Sprint `sprints/08111145-kernel-be8babea`。Evaluator 必须在该候选 SHA 的独立 detached worktree 根目录中串行执行七条原始命令；合同分支、当前控制仓 HEAD 与候选执行树严格分离。

## Response Schema（推导来源: PRD 字面）

N/A — 不新增 HTTP API。验收输出为七条结构化 `checks[]` 证据及候选执行上下文 provenance。

## 已知约束

- [冻结 thin PRD] 七条 `required_command_evidence` 必须逐字、严格串行执行，全部 `exit_code=0` 且 `log_tail` 非空才可 PASS。
- [冻结 thin PRD] 三地 5211 四资源逐字对账；WebKit fresh private context 等待 10 秒、刷新、再等待 10 秒后深链保持。
- [基础设施边界] Controller 已只读核对 HK access log；Fleet evaluator 无 HK SSH 私钥，不得把不能 SSH 读日志误判为页面失败。
- [累积 FR] context-manifest unavailable；本次以 frozen thin PRD 和 required commands 为唯一范围。

gp-anchor: skipped (product-map.json not found)

## Golden Path

覆盖父路 `Dashboard 生产入口发布与深链验收` 第 2-4 步。

### Step 1: 绑定冻结候选执行树
**来源**: `[AI_ADDED]` — Round 2 Reviewer R2-1 要求阻止在合同树或控制仓 HEAD 上冒充复验候选 SHA。

**可观测行为**: Runner 将 `CANDIDATE_DIR` late-bind 到精确 SHA 的 detached worktree；进入该目录后 HEAD 精确相等、工作树干净、七条命令所需路径均存在。所有后续 check 记录相同 `cwd`、`candidate_sha`、`git_status_porcelain`。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${CANDIDATE_DIR:?Runner must inject detached candidate worktree}"; cd "$CANDIDATE_DIR"; test "$(git rev-parse HEAD)" = f8fd3adae68195998198ad38a9c34c050fcab8c7; test -z "$(git status --porcelain)"; test -f tests/regression/dashboard-only-staging-contract.test.ts; printf "CANDIDATE_CONTEXT_OK cwd=%s sha=%s\n" "$PWD" "$(git rev-parse HEAD)"'
```

**硬阈值**: SHA 字面相等、porcelain 为空、关键回归文件存在；任一不满足即 fail closed，七条证据不得开始。

### Step 2: 严格串行运行五组永久回归
**来源**: `[FROM_PRD]` — thin PRD `required_command_evidence` 第 1-5 条。

**可观测行为**: 在同一冻结候选 worktree 根目录按给定顺序执行命令，不改写命令、不并行、不重试替换；每条记录非空日志与退出码。

**验证命令**: 见 `contract-dod.md` B-01 至 B-05，命令逐字等于 TaskBundle。

**硬阈值**: 五条依次 `exit_code=0` 且 `log_tail` 非空；任一失败立即停止且整体 FAIL。

### Step 3: 三地四资源精确对账
**来源**: `[FROM_PRD]` — thin PRD `required_command_evidence` 第 6 条。

**可观测行为**: LOCAL/US/HK 的 build-info、index、sw.js、deep route 逐字一致，三地 SHA 都等于冻结候选，旧 PWA 注册语义不存在。

**验证命令**: 见 `contract-dod.md` B-06，逐字使用 TaskBundle 第 6 条。

**硬阈值**: exit 0，非空日志必须含 `THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK f8fd3adae68195998198ad38a9c34c050fcab8c7`。

### Step 4: WebKit fresh private 深链稳定
**来源**: `[FROM_PRD]` — thin PRD `required_command_evidence` 第 7 条。

**可观测行为**: WebKit 全新 context 首次打开、等待 10 秒、刷新后再等 10 秒，pathname 始终 `/workbench/tasks`，service worker registrations 为 0。

**验证命令**: 见 `contract-dod.md` B-07，逐字使用 TaskBundle 第 7 条。

**硬阈值**: exit 0；非空 JSON 日志满足 `status=200`、`first=afterWait=second=/workbench/tasks`、`registrations=0`。

### Step 5: Evaluator 与独立 Judge 精确对账
**来源**: `[FROM_PRD]` — thin PRD 要求 Evaluator PASS 后进入独立 Judge 并逐条核对。

**可观测行为**: reconciliation 先核对候选 provenance，再按索引核对七条 command 完全相同、顺序不变、exit code 为 0、log tail 非空；Judge 使用自己的 late-bound identity 并引用 Evaluator evidence SHA-256。

**验证命令**:
```bash
node packages/brain/src/harness/reconcile-command-evidence.js --task-bundle "$TASK_BUNDLE_JSON" --evaluator-result "$EVALUATOR_RESULT_JSON" --expected-candidate-sha f8fd3adae68195998198ad38a9c34c050fcab8c7
```

**硬阈值**: provenance 与 7/7 证据全部匹配才可 PASS；缺项、乱序、命令不逐字、空日志、非零退出或 cwd/SHA 不一致均 FAIL。

## 真实调用方请求 shape

- 生产浏览器请求为 WebKit 对 `GET http://100.86.118.99:5211/workbench/tasks` 的普通导航；无业务认证 body。
- 资源对账严格使用 TaskBundle 第 6 条的 LOCAL/US/HK URL 与四个路径，不替换为 fixture。

## 禁 mock 边清单

- required command ↔ detached 候选 worktree：禁止在合同分支或其他 SHA 运行。
- curl/WebKit ↔ LOCAL/US/HK 真实 5211 入口：禁止 route、stub、缓存文件或离线响应替代。
- Evaluator checks ↔ Judge reconciliation：禁止以合同文本 grep 代替运行证据。

## 接缝清单

- 候选 Git 对象到执行目录：每条 check 留存同一 cwd 与 SHA provenance。
- 三地 5211 网络与静态资源：由第 6 条真实 curl 命令验证。
- HK WebKit：由第 7 条真实浏览器命令验证；接缝重复执行仅在 evaluator 能保持只读且预算允许时进行，七条正式 evidence 不重复。

## 未覆盖真实链路清单

- HK access log 已由 Controller 在本轮 WebKit 请求后只读核对；Fleet 无 HK SSH 私钥。该证据是基础设施补充，不属于七条 required command，不能替代或否定 B-07 页面结果。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 只读复验冻结候选的五组回归、三地资源和 WebKit 深链。 |
| NFR | 七条严格串行；全部 exit 0 且非空日志；超时沿命令原值。 |
| Invariant | 不改代码、不漂 SHA、不 mock 真入口、不泄露凭据。 |
| 判定点 | 见下表。 |
| 保质期 | 证据仅对本 run、冻结 SHA 与本次生产状态有效。 |
| 死亡告警 | 任一命令失败即 evaluator FAIL，并由 Judge 拒绝。 |
| 失败语义 | fail closed，不以网络说明、SSH 缺失或旧证据降级成功。 |
| 效果确认 | 7/7 checks + candidate provenance + Judge evidence hash。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 七条命令是否运行于冻结候选 | 相信控制仓 HEAD；记录每条 cwd/SHA | detached worktree 前置断言并逐 check 留 provenance | R2-1 实证控制树缺第 4 条文件 | 用错误 revision 冒充验收 |
| ⚠️ 三地是否同版 | 仅 SHA；逐资源 cmp | SHA + 四资源逐字 cmp | frozen thin PRD | 旧资源直接面客 |
| ⚠️ WebKit 深链是否稳定 | 单次 URL；等待刷新三次路径 | fresh context + 10s + reload + 10s | frozen thin PRD | Safari 用户回主页 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 候选 SHA/cwd 不符 | 不开始七条命令，FAIL | 新建正确 detached worktree 后可重派 | 无 |
| required command 非零或空日志 | 立即停止，FAIL | 不在同一 evidence 序列内重试 | 无 |
| HK SSH 不可用 | 不影响 B-07 的页面判定 | N/A | Controller access-log 补充证据独立留存 |

### 输入对抗面

N/A — 本任务不暴露新 agent 或写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: candidate cwd 指向合同分支时前置必须失败。
- 重复提交: 不得用重跑成功覆盖首次正式 evidence 失败。
- 中途中断: 第 N 条失败后不得继续并拼出 7 条成功数组。
- 边界值: 空 log_tail、仅空白日志、命令字符串单字符差异均拒绝。
发现分级: P0/P1 阻塞；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIR:?Runner must inject detached candidate worktree}"
cd "$CANDIDATE_DIR"
test "$(git rev-parse HEAD)" = f8fd3adae68195998198ad38a9c34c050fcab8c7
test -z "$(git status --porcelain)"
bash packages/quality/scripts/dashboard-only-production-chain.test.sh
bash scripts/smoke/dashboard-staging-gate-smoke.sh
bash scripts/smoke/deploy-chain-wounds-smoke.sh
npx vitest run tests/regression/dashboard-only-staging-contract.test.ts
cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js
cd "$CANDIDATE_DIR"
bash -c 'set -euo pipefail; SHA=f8fd3adae68195998198ad38a9c34c050fcab8c7; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; LOCAL=http://host.docker.internal:5211; US=http://100.71.151.105:5211; HK=http://100.86.118.99:5211; for N in LOCAL US HK; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; jq -e --arg sha "$SHA" '\''.git_sha==$sha'\'' "$T/$N.build" >/dev/null; done; cmp "$T/LOCAL.build" "$T/US.build"; cmp "$T/US.build" "$T/HK.build"; cmp "$T/LOCAL.index" "$T/US.index"; cmp "$T/US.index" "$T/HK.index"; cmp "$T/LOCAL.sw" "$T/US.sw"; cmp "$T/US.sw" "$T/HK.sw"; cmp "$T/LOCAL.deep" "$T/US.deep"; cmp "$T/US.deep" "$T/HK.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"; echo "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK $SHA"'
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e 'const { webkit } = require("/usr/local/lib/node_modules/playwright"); (async()=>{const browser=await webkit.launch({headless:true}); const context=await browser.newContext(); const page=await context.newPage(); const url="http://100.86.118.99:5211/workbench/tasks"; const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const first=new URL(page.url()).pathname; const afterWait=new URL(page.url()).pathname; await page.reload({waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const second=new URL(page.url()).pathname; const registrations=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0); console.log(JSON.stringify({status:response.status(),first,afterWait,second,registrations,url:page.url()})); await browser.close(); if(response.status()!==200||first!=="/workbench/tasks"||afterWait!=="/workbench/tasks"||second!=="/workbench/tasks"||registrations!==0)process.exit(1)})().catch(error=>{console.error(error);process.exit(1)})'
```

> 上述块表达串行语义；Evaluator 结构化执行时仍须把 TaskBundle 的七个字符串原样作为七条独立 checks，不能把整块合并成一条证据。

## staging 预览闸

本轮是已部署候选的只读 recurrence，不再次部署 staging。既有 user-facing 预览闸证据由原批准合同继承；本轮不得 PATCH promote 状态或发送新发布通知。

## Test Contract

| 功能 | Test File / Oracle | BEHAVIOR 覆盖 | 预期失败证据 |
|---|---|---|---|
| 五组永久回归 | TaskBundle commands 1-5 | `候选 SHA 上五组永久回归全绿` | 任一非零立即 FAIL |
| 三地对账 | TaskBundle command 6 | `三地四资源精确一致` | cmp/jq/curl 任一非零 |
| WebKit 深链 | TaskBundle command 7 | `fresh private context 等待刷新保持深链` | JSON 字段不符或进程非零 |

## Notes

contract-gate: 使用 Cecelia 仓现有 gate；本轮仅修改合同产物，不修改产品代码。
