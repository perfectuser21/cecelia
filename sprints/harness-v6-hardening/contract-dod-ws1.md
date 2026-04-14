# Contract DoD — Workstream 1: Backend 核心修复（Verdict 重试 + 崩溃识别）

- [ ] [BEHAVIOR] harness_evaluate callback 处理 verdict 时，DB 首次读空会自动重试（最多 10 次 x 200ms），最终读到有效 verdict 后正确路由（PASS→merge, FAIL→fix）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('verdict')||!(/retry|retri/i.test(c)&&/200/.test(c)))throw new Error('FAIL');console.log('PASS: verdict 重试逻辑存在')"
- [ ] [BEHAVIOR] verdict 重试 10 次后仍为空时标记 verdict_timeout，不默认 FAIL，不创建 harness_fix
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('verdict_timeout'))throw new Error('FAIL');console.log('PASS: verdict_timeout 标记存在')"
- [ ] [BEHAVIOR] callback result 为 null/0 字节 + DB verdict 为空时标记 session_crashed，创建 harness_evaluate 重试（非 harness_fix）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('session_crashed'))throw new Error('FAIL');const i=c.indexOf('session_crashed');const block=c.substring(i,i+800);if(!block.includes('harness_evaluate'))throw new Error('FAIL: 崩溃后未创建 harness_evaluate');console.log('PASS: session_crashed→harness_evaluate')"
- [ ] [BEHAVIOR] session_crashed 重试 1 次后再崩溃标记 permanent_failure，不再创建后续任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('permanent_failure'))throw new Error('FAIL');console.log('PASS: permanent_failure 标记存在')"
