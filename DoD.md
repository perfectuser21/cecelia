# DoD: Pipeline v2 清理

## D1: 旧 task type 从 task-router.js 删除
Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(c.includes(\"'cto_review'\"))process.exit(1)"

## D2: initiative_execute 注册到 task-router.js
Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes(\"'initiative_execute'\"))process.exit(1)"

## D3: decomp-check 目录已删除
Test: manual: node -e "if(require('fs').existsSync('packages/workflows/skills/decomp-check'))process.exit(1)"

## D4: executor.js 旧类型清理
Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes(\"'cto_review'\"))process.exit(1)"
