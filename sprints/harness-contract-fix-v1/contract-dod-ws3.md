# Contract DoD — Workstream 3: Report 失败自动重试

- [ ] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，且分支内有实际 createTask/createHarnessTask 调用
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");if(idx<0){console.error('FAIL: 缺少 harness_report 分支');process.exit(1)}const block=code.substring(idx,idx+1500);if(!block.includes('createTask')&&!block.includes('createHarnessTask')){console.error('FAIL: 无 createTask 调用');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 存在 result null 条件判断（确保重试仅在崩溃时触发）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/result\s*(===?\s*null|!==?\s*null)/.test(nc)){console.error('FAIL: 无 result null 判断');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 去除注释后 retry_count >= 3 上限检查存在（强制 >=），且之后有 return/break/throw 终止语句
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/retry_count\s*>=\s*3/.test(nc)){console.error('FAIL');process.exit(1)}const li=nc.search(/retry_count\s*>=\s*3/);const af=nc.substring(li,li+300);if(!/return|break|throw/.test(af.substring(0,200))){console.error('FAIL: 无终止语句');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试 payload 包含 sprint_dir、planner_task_id、retry_count、pr_url 四个必要字段
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');for(const f of['sprint_dir','planner_task_id','retry_count','pr_url']){if(!nc.includes(f)){console.error('FAIL: 缺少 '+f);process.exit(1)}}console.log('PASS')"
- [ ] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-pipeline.test.ts');console.log('PASS')"
