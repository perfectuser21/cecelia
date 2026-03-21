# DoD: 修复错误黑洞 — 错误传播、重试与可观测性

- [ ] [ARTIFACT] `routes/execution.js` dev 重试 UPDATE SQL 含 `retry_count = retry_count + 1`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('retry_count = retry_count + 1'))process.exit(1);console.log('OK')"

- [ ] [BEHAVIOR] `classifyDevFailure` 在 `result.failure_class='code_error'` 时返回 `retryable: true`
  Test: manual:node -e "import('./packages/brain/src/dev-failure-classifier.js').then(m=>{const r=m.classifyDevFailure({failure_class:'code_error',exit_code:1,stderr:'err'},'AI Failed',{retryCount:0});if(!r.retryable||r.class!=='code_error')process.exit(1);console.log('OK')})"

- [ ] [BEHAVIOR] `classifyDevFailure` 在 `result=null + exitCode=1` 时返回 code_error 可重试
  Test: manual:node -e "import('./packages/brain/src/dev-failure-classifier.js').then(m=>{const r=m.classifyDevFailure(null,'AI Failed',{retryCount:0,exitCode:1});if(!r.retryable||r.class!=='code_error')process.exit(1);console.log('OK')})"

- [ ] [GATE] dev-failure-classifier 全部测试通过（含新增用例）
  Test: manual:bash -c "cd packages/brain && node --experimental-vm-modules $(npm root)/.bin/vitest run src/__tests__/dev-failure-classifier.test.js 2>&1 | tail -5"
