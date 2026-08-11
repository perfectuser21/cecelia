---
skeleton: false
journey_type: user_facing
---
# Contract DoD — PR #4794 冻结候选只读复验

**范围**: 只读复验精确 SHA `f8fd3adae68195998198ad38a9c34c050fcab8c7`；禁止生成或修改产品代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 候选执行上下文 provenance 含 detached worktree 绝对路径、精确 SHA、空 git porcelain
  Test: node -e "const p=JSON.parse(require('fs').readFileSync(process.env.EVALUATOR_RESULT_JSON));if(p.candidate_sha!=='f8fd3adae68195998198ad38a9c34c050fcab8c7'||!p.candidate_cwd||p.git_status_porcelain!=='')process.exit(1)"
- [ ] [ARTIFACT] Evaluator 结果含恰好七条 checks，Judge 引用该结果的 SHA-256
  Test: node -e "const p=JSON.parse(require('fs').readFileSync(process.env.EVALUATOR_RESULT_JSON));if(!Array.isArray(p.checks)||p.checks.length!==7)process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 候选 SHA 上运行 Dashboard-only production chain 回归
  动作: 在已断言 SHA 的候选 worktree 执行 required command 1
  预期观察: 回归脚本成功并输出非空日志
  等待预算: 300s
  留证: checks[0] 的 command、cwd、candidate_sha、exit_code、log_tail
  Test: manual:bash packages/quality/scripts/dashboard-only-production-chain.test.sh

- [ ] [BEHAVIOR] [L2] B-02: 候选 SHA 上运行 staging gate smoke
  动作: 严格在 B-01 后执行 required command 2
  预期观察: smoke 成功并输出非空日志
  等待预算: 300s
  留证: checks[1] 的完整结构化证据
  Test: manual:bash scripts/smoke/dashboard-staging-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] B-03: 候选 SHA 上运行 deploy chain wounds smoke
  动作: 严格在 B-02 后执行 required command 3
  预期观察: smoke 成功并输出非空日志
  等待预算: 300s
  留证: checks[2] 的完整结构化证据
  Test: manual:bash scripts/smoke/deploy-chain-wounds-smoke.sh

- [ ] [BEHAVIOR] [L2] B-04: 候选 SHA 上运行 dashboard-only staging contract 回归
  动作: 严格在 B-03 后执行 required command 4
  预期观察: Vitest 文件存在且测试成功，日志非空
  等待预算: 300s
  留证: checks[3] 的完整结构化证据
  Test: manual:npx vitest run tests/regression/dashboard-only-staging-contract.test.ts

- [ ] [BEHAVIOR] [L2] B-05: 候选 SHA 上运行 staging runner 两组回归
  动作: 严格在 B-04 后执行 required command 5
  预期观察: 两个 Vitest 文件全部成功，日志非空
  等待预算: 300s
  留证: checks[4] 的完整结构化证据
  Test: manual:cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js

- [ ] [BEHAVIOR] [L3] B-06: LOCAL/US/HK 三地四资源精确对账 [接缝×2]
  动作: 严格在 B-05 后执行 required command 6，真实请求三地 5211 四资源
  预期观察: 三地 SHA 等于冻结候选、四资源逐字一致、旧 PWA 注册语义不存在
  等待预算: 180s
  留证: checks[5] 非空日志含 THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK 与冻结 SHA
  Test: manual:bash -c 'set -euo pipefail; SHA=f8fd3adae68195998198ad38a9c34c050fcab8c7; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; LOCAL=http://host.docker.internal:5211; US=http://100.71.151.105:5211; HK=http://100.86.118.99:5211; for N in LOCAL US HK; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; jq -e --arg sha "$SHA" '\''.git_sha==$sha'\'' "$T/$N.build" >/dev/null; done; cmp "$T/LOCAL.build" "$T/US.build"; cmp "$T/US.build" "$T/HK.build"; cmp "$T/LOCAL.index" "$T/US.index"; cmp "$T/US.index" "$T/HK.index"; cmp "$T/LOCAL.sw" "$T/US.sw"; cmp "$T/US.sw" "$T/HK.sw"; cmp "$T/LOCAL.deep" "$T/US.deep"; cmp "$T/US.deep" "$T/HK.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"; echo "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK $SHA"'

- [ ] [BEHAVIOR] [L3] B-07: WebKit fresh private context 等待刷新保持深链 [接缝×2]
  动作: 严格在 B-06 后执行 required command 7，新建 WebKit context 访问 HK 深链
  预期观察: 首次、等待 10 秒、刷新后再等 10 秒均保持 `/workbench/tasks`，registrations 为 0
  等待预算: 60s
  留证: checks[6] 非空 JSON 日志及 Controller 独立 access-log 补充证据
  Test: manual:PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e 'const { webkit } = require("/usr/local/lib/node_modules/playwright"); (async()=>{const browser=await webkit.launch({headless:true}); const context=await browser.newContext(); const page=await context.newPage(); const url="http://100.86.118.99:5211/workbench/tasks"; const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const first=new URL(page.url()).pathname; const afterWait=new URL(page.url()).pathname; await page.reload({waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const second=new URL(page.url()).pathname; const registrations=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0); console.log(JSON.stringify({status:response.status(),first,afterWait,second,registrations,url:page.url()})); await browser.close(); if(response.status()!==200||first!=="/workbench/tasks"||afterWait!=="/workbench/tasks"||second!=="/workbench/tasks"||registrations!==0)process.exit(1)})().catch(error=>{console.error(error);process.exit(1)})'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 七条证据与 frozen required commands 精确一致
  动作: Judge 读取 TaskBundle 与 Evaluator 结构化结果并执行 reconciliation
  预期观察: checks 恰好七条，按索引 command 字节相同、exit_code=0、log_tail 去空白后非空，且共享候选 cwd/SHA
  等待预算: 10s
  留证: reconciliation 输出与 Evaluator evidence SHA-256
  Test: manual:node packages/brain/src/harness/reconcile-command-evidence.js --task-bundle "$TASK_BUNDLE_JSON" --evaluator-result "$EVALUATOR_RESULT_JSON" --expected-candidate-sha f8fd3adae68195998198ad38a9c34c050fcab8c7

- [ ] [BEHAVIOR] [L2] INV-2: validation identity 仅从 Runner late-bound
  动作: Evaluator 与 Judge 分别读取自己的 HARNESS 与 CAPABILITY 变量
  预期观察: 两角色 provenance 独立非空，Judge 引用 Evaluator evidence hash
  等待预算: 0s
  留证: 两角色 provenance
  Test: manual:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; : "${HARNESS_PROVIDER:?}"; : "${HARNESS_MACHINE:?}"'

- [ ] [BEHAVIOR] [L2] INV-3: 只读复验不产生工作树变更
  动作: 七条命令结束后检查候选 worktree
  预期观察: git porcelain 仍为空且 HEAD 未漂移
  等待预算: 0s
  留证: post-run SHA 与 porcelain
  Test: manual:bash -c 'test "$(git rev-parse HEAD)" = f8fd3adae68195998198ad38a9c34c050fcab8c7; test -z "$(git status --porcelain)"'

- [ ] [BEHAVIOR] [L2] INV-4: HK SSH 边界不改写页面结论
  动作: Judge 核对 B-07 与 Controller access-log 证据来源分离
  预期观察: B-07 仅按其 exit/JSON 判定；无 HK SSH 私钥不被解释为页面失败或成功
  等待预算: 0s
  留证: Judge reason 中的基础设施边界说明
  Test: manual:node -e 'const p=JSON.parse(require("fs").readFileSync(process.env.EVALUATOR_RESULT_JSON));const c=p.checks[6];if(!c||c.exit_code!==0||!String(c.log_tail||"").trim())process.exit(1)'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] 七条正式 checks 在冻结候选执行树严格串行全部通过，随后进入独立 Judge
  Screenshots: N/A — 本合同的用户可观察证据为 WebKit JSON 路径状态与三地真实资源响应；不以截图替代机器 oracle。
