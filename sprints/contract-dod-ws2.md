# Contract DoD — Workstream 2: Caller Migration + Inline Logic Extraction

**范围**: `packages/brain/src/executor.js` HARNESS_DOCKER_ENABLED 分支替换为 `spawn()`；删除 3037-3078 行内联 cap/selectBestAccount 调用；`harness-graph-runner.js` 与 `workflows/content-pipeline-runner.js` 默认 dockerExecutor 改 `spawn`；billing.js 字段集合与 executor.js 旧 SQL UPDATE 字段做 cross-check（R3 mitigation）
**大小**: M（executor.js 净 -40 行；其它 2 文件各 +/- 3 行）
**依赖**: WS1（spawn() 必须先有真实 middleware 装配；本 WS 测试中可 mock spawn 解耦）

## ARTIFACT 条目

- [ ] [ARTIFACT] executor.js 不再 import isSpendingCapped 或 selectBestAccount
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const m=c.match(/^import[^;]*from\\s+['\"][^'\"]*account-usage[^'\"]*['\"];?$/gm)||[];for(const line of m){if(/isSpendingCapped|selectBestAccount/.test(line)){console.error('forbidden import:',line);process.exit(1)}}"

- [ ] [ARTIFACT] executor.js 不再 import executeInDocker
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const m=c.match(/^import[^;]*from\\s+['\"][^'\"]*docker-executor[^'\"]*['\"];?$/gm)||[];for(const line of m){if(/\\bexecuteInDocker\\b/.test(line)){console.error('forbidden import:',line);process.exit(1)}}"

- [ ] [ARTIFACT] executor.js 必须 import spawn（HARNESS_DOCKER_ENABLED 分支替换为 spawn() 调用）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/import\\s*\\{[^}]*\\bspawn\\b[^}]*\\}\\s*from\\s+['\"][^'\"]*spawn[^'\"]*['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] executor.js HARNESS_DOCKER_ENABLED 分支不再直接调用 isSpendingCapped 或 selectBestAccount
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(/\\bisSpendingCapped\\s*\\(/.test(c)){console.error('isSpendingCapped( still called');process.exit(1)}if(/\\bselectBestAccount\\s*\\(/.test(c)){console.error('selectBestAccount( still called');process.exit(1)}"

- [ ] [ARTIFACT] executor.js HARNESS_DOCKER_ENABLED 分支不再调用 executeInDocker(
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(/\\bexecuteInDocker\\s*\\(/.test(c)){console.error('executeInDocker( still called');process.exit(1)}"

- [ ] [ARTIFACT] harness-graph-runner.js 默认 dockerExecutor 改为 spawn
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(!/import\\s*\\{[^}]*\\bspawn\\b[^}]*\\}\\s*from\\s+['\"][^'\"]*spawn[^'\"]*['\"]/.test(c)){console.error('missing spawn import');process.exit(1)}if(!/opts\\.dockerExecutor\\s*\\|\\|\\s*spawn\\b/.test(c)){console.error('default dockerExecutor not spawn');process.exit(1)}"

- [ ] [ARTIFACT] workflows/content-pipeline-runner.js 默认 dockerExecutor 改为 spawn
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/content-pipeline-runner.js','utf8');if(!/import\\s*\\{[^}]*\\bspawn\\b[^}]*\\}\\s*from\\s+['\"][^'\"]*spawn[^'\"]*['\"]/.test(c)){console.error('missing spawn import');process.exit(1)}if(!/opts\\.dockerExecutor\\s*\\|\\|\\s*spawn\\b/.test(c)){console.error('default dockerExecutor not spawn');process.exit(1)}"

- [ ] [ARTIFACT] grep guard：spawn/ 与 __tests__/ 之外的业务文件不再 import executeInDocker
  Test: bash -c "OUT=\$(grep -rln 'from.*docker-executor' packages/brain/src/ 2>/dev/null | grep -v '__tests__' | grep -v 'spawn/' | xargs -I{} grep -l 'executeInDocker' {} 2>/dev/null | grep -v 'docker-executor.js$' || true); if [ -n \"\$OUT\" ]; then echo \"stray executeInDocker imports:\"; echo \"\$OUT\"; exit 1; fi"

- [ ] [ARTIFACT] billing.js 字段集合 cross-check：必须含 dispatched_account 与 dispatched_model（R3 mitigation，与 executor.js:3066-3067 旧 SQL UPDATE 字段集合 byte-equal）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/middleware/billing.js','utf8');if(!/\\bdispatched_account\\b/.test(c)){console.error('billing.js missing dispatched_account field');process.exit(1)}if(!/\\bdispatched_model\\b/.test(c)){console.error('billing.js missing dispatched_model field');process.exit(1)}"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/caller-migration.test.ts`，覆盖：
- executor.js no longer imports isSpendingCapped or selectBestAccount from account-usage
- executor.js no longer imports executeInDocker from docker-executor
- executor.js HARNESS_DOCKER_ENABLED branch invokes spawn(), not executeInDocker, when triggered
- executor.js HARNESS_DOCKER_ENABLED branch no longer contains inline isSpendingCapped or selectBestAccount calls
- harness-graph-runner default dockerExecutor is spawn, not executeInDocker
- content-pipeline-runner default dockerExecutor is spawn, not executeInDocker
- opts.dockerExecutor injection still overrides the spawn default in both runners
- grep guard: no business file under packages/brain/src/ (excluding spawn/ and __tests__/) imports executeInDocker
- billing dispatched_account field-set cross-check: billing.js payload keys ⊇ {dispatched_account, dispatched_model}（R3 mitigation）
