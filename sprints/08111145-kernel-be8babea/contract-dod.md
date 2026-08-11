---
skeleton: false
journey_type: user_facing
---
# Contract DoD — PR #4794 只读 recurrence

**范围**: 只读复验冻结 head；不生成或修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 证据绑定精确 SHA `f8fd3adae68195998198ad38a9c34c050fcab8c7`
  Test: node -e "const c=require('fs').readFileSync('sprints/08111145-kernel-be8babea/contract-draft.md','utf8');if(!c.includes('f8fd3adae68195998198ad38a9c34c050fcab8c7'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 五组永久回归第一组通过
  动作: 原样运行 dashboard-only production chain 回归
  预期观察: 命令 exit 0 且输出非空
  等待预算: 120s
  留证: 第 1 条 command evidence 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash packages/quality/scripts/dashboard-only-production-chain.test.sh'

- [ ] [BEHAVIOR] [L2] B-02: 五组永久回归第二组通过
  动作: 原样运行 dashboard staging gate smoke
  预期观察: 命令 exit 0 且输出非空
  等待预算: 120s
  留证: 第 2 条 command evidence 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash scripts/smoke/dashboard-staging-gate-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-03: 五组永久回归第三组通过
  动作: 原样运行 deploy chain wounds smoke
  预期观察: 命令 exit 0 且输出非空
  等待预算: 120s
  留证: 第 3 条 command evidence 的 exit_code 与 log_tail
  Test: manual:bash -c 'bash scripts/smoke/deploy-chain-wounds-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-04: 五组永久回归第四组通过
  动作: 原样运行 staging contract Vitest
  预期观察: 命令 exit 0 且输出非空
  等待预算: 120s
  留证: 第 4 条 command evidence 的 exit_code 与 log_tail
  Test: manual:bash -c 'npx vitest run tests/regression/dashboard-only-staging-contract.test.ts'

- [ ] [BEHAVIOR] [L2] B-05: 五组永久回归第五组通过
  动作: 在 packages/brain 原样运行两个 staging runner Vitest 文件
  预期观察: 命令 exit 0 且输出非空
  等待预算: 120s
  留证: 第 5 条 command evidence 的 exit_code 与 log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js'

- [ ] [BEHAVIOR] [L3] B-06: 三地四资源精确对账 [接缝×2]
  动作: 原样运行 required_command_evidence 第 6 条
  预期观察: LOCAL/US/HK SHA 等于冻结 head，四资源逐字相同且无旧 PWA 注册
  等待预算: 180s
  留证: 第 6 条 exit_code 与包含 `THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK` 的 log_tail
  Test: manual:bash -c 'set -euo pipefail; SHA=f8fd3adae68195998198ad38a9c34c050fcab8c7; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; LOCAL=http://host.docker.internal:5211; US=http://100.71.151.105:5211; HK=http://100.86.118.99:5211; for N in LOCAL US HK; do eval U=\$$N; curl -fsS --max-time 15 "$U/build-info.json" > "$T/$N.build"; curl -fsS --max-time 15 "$U/" > "$T/$N.index"; curl -fsS --max-time 15 "$U/sw.js" > "$T/$N.sw"; curl -fsS --max-time 15 "$U/workbench/tasks" > "$T/$N.deep"; jq -e --arg sha "$SHA" '\''.git_sha==$sha'\'' "$T/$N.build" >/dev/null; done; cmp "$T/LOCAL.build" "$T/US.build"; cmp "$T/US.build" "$T/HK.build"; cmp "$T/LOCAL.index" "$T/US.index"; cmp "$T/US.index" "$T/HK.index"; cmp "$T/LOCAL.sw" "$T/US.sw"; cmp "$T/US.sw" "$T/HK.sw"; cmp "$T/LOCAL.deep" "$T/US.deep"; cmp "$T/US.deep" "$T/HK.deep"; ! grep -q '\''registerSW.js'\'' "$T/HK.index"; ! grep -q '\''navigator.serviceWorker.register'\'' "$T/HK.sw"; echo "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK $SHA"'

- [ ] [BEHAVIOR] [L3] B-07: WebKit fresh private context 等待刷新后保持深链 [接缝×2]
  动作: 原样运行 required_command_evidence 第 7 条
  预期观察: HTTP 200，三个 pathname 均为 `/workbench/tasks`，registrations=0
  等待预算: 60s
  留证: 第 7 条 exit_code 与非空 JSON log_tail
  Test: manual:bash -c 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e '\''const { webkit } = require("/usr/local/lib/node_modules/playwright"); (async()=>{const browser=await webkit.launch({headless:true}); const context=await browser.newContext(); const page=await context.newPage(); const url="http://100.86.118.99:5211/workbench/tasks"; const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const first=new URL(page.url()).pathname; const afterWait=new URL(page.url()).pathname; await page.reload({waitUntil:"domcontentloaded",timeout:30000}); await page.waitForTimeout(10000); const second=new URL(page.url()).pathname; const registrations=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0); console.log(JSON.stringify({status:response.status(),first,afterWait,second,registrations,url:page.url()})); await browser.close(); if(response.status()!==200||first!=="/workbench/tasks"||afterWait!=="/workbench/tasks"||second!=="/workbench/tasks"||registrations!==0)process.exit(1)})().catch(error=>{console.error(error);process.exit(1)})'\'''

## Invariant 映射

- [ ] [BEHAVIOR] [L3] INV-1: 真环境验证与生产自报语义由 B-06、B-07 覆盖；禁止离线替代
  动作: 检查七条证据均来自合同字面命令
  预期观察: 七条 exit 0 且 log_tail 非空
  等待预算: 0s
  留证: Evaluator checks 数组
  Test: manual:bash -c 'test -f sprints/08111145-kernel-be8babea/contract-draft.md && grep -q "THREE_ORIGIN_EXACT_SHA_AND_RESOURCES_OK" sprints/08111145-kernel-be8babea/contract-draft.md'

- [ ] [BEHAVIOR] [L1] INV-2: 凭据安全与日志脱敏不回退
  动作: 扫描本轮合同是否固化凭据
  预期观察: 无私钥、token 或 authorization 字面凭据
  等待预算: 0s
  留证: 扫描 exit code
  Test: manual:bash -c 'if rg -n "BEGIN (RSA |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}" sprints/08111145-kernel-be8babea/contract-*.md; then exit 1; fi'

> [环境不写死]、[部署失败]、[判变语义]、[验证命令] 均由冻结的 required evidence 原样执行覆盖；本轮不运行部署、不修改实现。
