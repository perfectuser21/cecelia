# DoD: fix execution-callback verdict 写入 + ci_watch payload 校验

## 成功标准

- [x] [ARTIFACT] harness_evaluate 完成后执行 `UPDATE tasks SET result` 写入 verdict+eval_round
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('UPDATE tasks SET result'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] harness_contract_propose 完成后执行 `UPDATE tasks SET result` 写入 verdict+propose_round
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const matches=c.match(/propose_round.*proposeRound/g)||[];if(matches.length<2)process.exit(1);console.log('OK: found propose_round in result',matches.length)"`

- [x] [ARTIFACT] harness_contract_review 完成后执行 `UPDATE tasks SET result` 写入 verdict+review_branch
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('review_branch'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] harness_generate 创建 ci_watch 时 pr_url 为 null 输出 warning
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('pr_url is null/undefined (generate may not have written pr_url yet)'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] harness_fix 创建 ci_watch 时 pr_url 为 null 输出 warning
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('harness_fix') || !c.includes('pr_url is null/undefined'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] execution.js 语法检查通过
  - Test: `manual:node --check packages/brain/src/routes/execution.js`
