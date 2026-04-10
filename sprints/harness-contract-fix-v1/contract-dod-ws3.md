# Contract DoD — Workstream 3: Report 失败自动重试

- [ ] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，result=null 时创建重试任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes(\"harnessType === 'harness_report'\")){console.error('FAIL: no harness_report handler');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试任务 payload 包含 retry_count 且上限为 3（超过不再重试）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const b=c.substring(c.indexOf(\"harnessType === 'harness_report'\"));if(!b.includes('retry_count')){console.error('FAIL: no retry_count');process.exit(1)}if(!/retry_count.*>=?\s*3/.test(b.substring(0,800))){console.error('FAIL: no limit check');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-pipeline.test.ts');console.log('PASS')"
