---
skeleton: false
journey_type: user_facing
---
# Contract DoD — PR #4794 只读 recurrence 10

**范围**: 只读复验冻结 head `f8fd3adae68195998198ad38a9c34c050fcab8c7`；禁止生成或修改产品代码、测试、部署与外部状态。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] Evaluator 结构化结果含七个独立 checks，且由独立 Judge 消费
  Test: node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.env.EVALUATOR_RESULT_PATH,'utf8'));const c=r.checks??r.behavior_tests;if(!Array.isArray(c)||c.length<7)process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 永久发布主链回归通过
  动作: 原样执行 required_command_evidence 第 1 条
  预期观察: 命令 exit 0 且日志非空
  等待预算: 120s
  留证: checks[0] 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash packages/quality/scripts/dashboard-only-production-chain.test.sh'

- [ ] [BEHAVIOR] [L2] B-02: staging gate smoke 通过
  动作: 原样执行 required_command_evidence 第 2 条
  预期观察: 命令 exit 0 且日志非空
  等待预算: 120s
  留证: checks[1] 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash scripts/smoke/dashboard-staging-gate-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-03: deploy chain wounds smoke 通过
  动作: 原样执行 required_command_evidence 第 3 条
  预期观察: 命令 exit 0 且日志非空
  等待预算: 120s
  留证: checks[2] 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash scripts/smoke/deploy-chain-wounds-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-04: staging contract Vitest 通过
  动作: 原样执行 required_command_evidence 第 4 条
  预期观察: 命令 exit 0 且日志非空
  等待预算: 120s
  留证: checks[3] 的 exit_code 与 log_tail
  Test: manual:bash -c 'npx vitest run tests/regression/dashboard-only-staging-contract.test.ts'

- [ ] [BEHAVIOR] [L2] B-05: Brain staging runner 两组 Vitest 通过
  动作: 原样执行 required_command_evidence 第 5 条
  预期观察: 命令 exit 0 且日志非空
  等待预算: 120s
  留证: checks[4] 的 exit_code 与 log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js'

- [ ] [BEHAVIOR] [L3] B-06: LOCAL/US/HK 三地四资源精确一致 [接缝×2]
  动作: 原样执行 required_command_evidence 第 6 条，请求三地四类资源并逐字对账
  预期观察: 三地 SHA 等于冻结 head，四类资源 cmp 全部为 0，stdout 含成功标志
  等待预算: 180s
  留证: checks[5] 的 exit_code 与非空 log_tail
  Test: manual:bash -c 'set -euo pipefail; SHA=f8fd3adae68195998198ad38a9c34c050fcab8c7; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; LOCAL=http://host.docker.internal:5211; US=http://100.71.151.105:5211; HK=http://100.86.118.99:5211; for N in LOCAL US HK; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; jq -e --arg sha "$SHA" '\''.git_sha==$sha'\'' "$T/$N.build" >/dev/null; done; cmp "$T/LOCAL.build" "$T/US.build"; cmp "$T/US.build" "$T/HK.build"; cmp "$T/LOCAL.index" "$T/US.index"; cmp "$T/US.index" "$T/HK.index"; cmp "$T/LOCAL.sw" "$T/US.sw"; cmp "$T/US.sw" "$T/HK.sw"; cmp "$T/LOCAL.deep" "$T/US.deep"; cmp "$T/US.deep" "$T/HK.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"; echo "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK $SHA"'

- [ ] [BEHAVIOR] [L3] B-07: WebKit fresh private context 等待刷新后深链保持 [接缝×2]
  动作: 原样执行 required_command_evidence 第 7 条，用真实 WebKit 新 context 访问 HK
  预期观察: HTTP 200，等待与刷新后三次 pathname 均为 `/workbench/tasks`，registrations 为 0
  等待预算: 60s
  留证: checks[6] 的 JSON log_tail 与 exit_code
  Test: manual:bash -c 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e '\''const { webkit } = require("/usr/local/lib/node_modules/playwright"); (async()=>{const browser=await webkit.launch({headless:true}); const context=await browser.newContext(); const page=await context.newPage(); const url="http://100.86.118.99:5211/workbench/tasks"; const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const first=new URL(page.url()).pathname; const afterWait=new URL(page.url()).pathname; await page.reload({waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const second=new URL(page.url()).pathname; const registrations=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0); console.log(JSON.stringify({status:response.status(),first,afterWait,second,registrations,url:page.url()})); await browser.close(); if(response.status()!==200||first!=="/workbench/tasks"||afterWait!=="/workbench/tasks"||second!=="/workbench/tasks"||registrations!==0)process.exit(1)})().catch(error=>{console.error(error);process.exit(1)})'\'''

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 七条运行证据结构化完整性
  动作: Judge 读取当前 TaskBundle 与 Evaluator 结果，逐字对账 required_command_evidence 和 checks
  预期观察: 七条命令各有一条 command 完全相同、exit_code=0、log_tail 非空的证据
  等待预算: 0s
  留证: Judge 对账输出 `SEVEN_REQUIRED_COMMAND_EVIDENCE_OK`
  Test: manual:bash -c 'node -e '\''const fs=require("fs");(async()=>{const b=JSON.parse(fs.readFileSync(process.env.TASK_BUNDLE_PATH,"utf8"));const e=JSON.parse(fs.readFileSync(process.env.EVALUATOR_RESULT_PATH,"utf8"));const checks=e.checks??e.behavior_tests;const {reconcileRequiredCommandEvidence}=await import("./packages/brain/src/orchestrator/required-command-evidence.js");const r=reconcileRequiredCommandEvidence(b.inputs.required_command_evidence,checks);if(!r.valid||!r.complete)throw new Error(JSON.stringify(r));console.log("SEVEN_REQUIRED_COMMAND_EVIDENCE_OK")})().catch(x=>{console.error(x);process.exit(1)})'\'''

- [ ] [BEHAVIOR] [L2] INV-2: validation identity 仅从 Runner late-bound
  动作: 验证当前角色身份变量存在
  预期观察: 当前 attempt 与 capability snapshot 非空
  等待预算: 0s
  留证: 当前角色 provenance
  Test: manual:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"'

其余 PRD 铁律映射：环境不写死 N/A（地址与 SHA 来自冻结验收合同）；部署失败、生产自报、语义一致由 B-01/B-03/B-06 覆盖；凭据安全与日志脱敏由无凭据请求及 Controller access-log 只读补证覆盖。本轮禁止外部写入。
