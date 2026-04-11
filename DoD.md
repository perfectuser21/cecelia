contract_branch: cp-harness-contract-19fd9c85
workstream_index: 3
sprint_dir: sprints/harness-contract-fix-v1

## Workstream 2: Pipeline 状态可视化 API

- [x] [BEHAVIOR] GET /api/brain/harness/pipeline/:planner_task_id 返回 HTTP 200 + JSON，包含该 pipeline 所有 harness 任务
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length===0)throw new Error('FAIL');console.log('PASS: '+t.length+' tasks')"
- [x] [BEHAVIOR] 每个节点包含 task_id、task_type、status 三个必填字段
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=(d.tasks||d)[0];['task_id','task_type','status'].forEach(f=>{if(!(f in t))throw new Error('FAIL: missing '+f)});console.log('PASS')"
- [x] [BEHAVIOR] 不存在的 planner_task_id 返回空数组（不是 404）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length!==0)throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] 返回的任务按创建时间升序排列
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(t.length<2){console.log('PASS: skip');process.exit(0)}for(let i=1;i<t.length;i++){if(new Date(t[i].created_at||t[i].createdAt)<new Date(t[i-1].created_at||t[i-1].createdAt))throw new Error('FAIL')}console.log('PASS')"

## Workstream 3: Report 失败自动重试

- [x] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，且分支内有实际 createTask/createHarnessTask 调用（去除注释后验证）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");if(idx<0){console.error('FAIL: 缺少 harness_report 分支');process.exit(1)}const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!nc.includes('createTask')&&!nc.includes('createHarnessTask')){console.error('FAIL: 无 createTask 调用');process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] createTask 在 result null 条件判断之后（结构性守护：条件块内执行，非无条件调用）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');const nullIdx=nc.search(/result\s*===?\s*null|!\s*result/);const createIdx=nc.search(/createTask|createHarnessTask/);if(nullIdx<0){console.error('FAIL: 无 result null 判断');process.exit(1)}if(createIdx<0){console.error('FAIL: 无 createTask 调用');process.exit(1)}if(createIdx<nullIdx){console.error('FAIL: createTask 出现在 result null 判断之前（重试未被条件守护）');process.exit(1)}console.log('PASS: createTask 在 result null 条件判断之后')"
- [x] [BEHAVIOR] 去除注释后 retry_count >= 3 上限检查存在（强制 >=），且之后有 return/break/throw 终止语句
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/retry_count\s*>=\s*3/.test(nc)){console.error('FAIL');process.exit(1)}const li=nc.search(/retry_count\s*>=\s*3/);const af=nc.substring(li,li+300);if(!/return|break|throw/.test(af.substring(0,200))){console.error('FAIL: 无终止语句');process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] 重试 payload 包含 sprint_dir、planner_task_id、retry_count、pr_url 四个必要字段
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');for(const f of['sprint_dir','planner_task_id','retry_count','pr_url']){if(!nc.includes(f)){console.error('FAIL: 缺少 '+f);process.exit(1)}}console.log('PASS')"
- [x] [BEHAVIOR] retry_count >= 3 到 return/break/throw 之间不允许出现 createTask/createHarnessTask 调用
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');const li=nc.search(/retry_count\s*>=\s*3/);if(li<0){console.error('FAIL');process.exit(1)}const af=nc.substring(li,li+300);const ti=af.search(/return|break|throw/);if(ti<0||ti>200){console.error('FAIL');process.exit(1)}if(/createTask|createHarnessTask/.test(af.substring(0,ti))){console.error('FAIL: >= 3 到 return 间有 createTask');process.exit(1)}console.log('PASS')"
- [x] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑（文件存在且含测试定义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-pipeline.test.ts','utf8');if(!c.includes('describe')||!c.includes('test')){console.error('FAIL: 测试文件缺少 describe/test 定义');process.exit(1)}console.log('PASS')"
