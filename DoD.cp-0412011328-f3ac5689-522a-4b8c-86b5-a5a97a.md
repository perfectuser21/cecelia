# DoD: 重构 preparePrompt 圈复杂度 77→6

## 目标
Brain 复杂度扫描器发现 executor.js 中的 preparePrompt 函数圈复杂度 77，超过阈值 10。
重构降低复杂度，并添加回归测试防止反弹。

## 验收条件

- [x] [BEHAVIOR] preparePrompt 函数圈复杂度降至 10 以下（当前 CC=6）
  Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/executor.js','utf8');const m=/async function preparePrompt\\\(task\\\)/g.exec(c);const brace=c.indexOf('{',m.index);let d=0,e=brace;for(let i=brace;i<c.length;i++){if(c[i]==='{')d++;else if(c[i]==='}'){d--;if(d===0){e=i+1;break;}}}const body=c.slice(brace,e);const br=[/\\\bif\\\b/g,/\\\bwhile\\\b/g,/\\\bfor\\\b/g,/&&/g,/\\\|\\\|/g].reduce((n,r)=>n+(body.match(r)||[]).length,0);const cc=br+1;if(cc>10){process.exit(1);}console.log('CC='+cc+' OK')"

- [x] [ARTIFACT] 路由表提升为模块级常量 _TASK_ROUTES（脱离 preparePrompt 函数体）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('const _TASK_ROUTES = {'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 内联 lambda 提取为命名函数（_prepareInitiativePlanPrompt 等 6 个）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');['_prepareInitiativePlanPrompt','_prepareInitiativeVerifyPrompt','_prepareArchitectureDesignPrompt','_prepareDecompReviewPrompt','_preparePrdReviewPrompt','_prepareInitiativeReviewPrompt'].forEach(n=>{if(!c.includes(n))throw new Error(n+' missing');});console.log('OK')"

- [x] [BEHAVIOR] 回归测试通过，保护复杂度不反弹
  Test: tests/packages/brain/src/__tests__/executor-prepare-prompt-complexity.test.js

## 成功标准

preparePrompt 圈复杂度降至 10 以下，测试全部通过。
