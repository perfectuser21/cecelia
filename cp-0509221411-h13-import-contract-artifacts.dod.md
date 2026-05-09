# DoD: H13 spawnGeneratorNode import contract artifacts

## 验收清单

- [ ] [BEHAVIOR] spawnNode contractBranch 存在时 import sprints/（git fetch + checkout + add + commit）
  Test: tests/brain/h13-import-contract-artifacts.test.js

- [ ] [BEHAVIOR] spawnNode contractBranch null 时不 import
  Test: tests/brain/h13-import-contract-artifacts.test.js

- [ ] [BEHAVIOR] spawnNode contractImported=true 时短路（幂等门）
  Test: tests/brain/h13-import-contract-artifacts.test.js

- [ ] [BEHAVIOR] spawnNode import 失败 return error
  Test: tests/brain/h13-import-contract-artifacts.test.js

- [ ] [ARTIFACT] harness-task.graph.js spawnNode 函数体含 'fetch' + 'checkout' + 'sprints/' + 'import contract' 字面量
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const m=c.match(/export async function spawnNode[\s\S]+?\n\}/);if(!m)process.exit(1);if(!/'fetch'/.test(m[0]))process.exit(1);if(!/'checkout'/.test(m[0]))process.exit(1);if(!/sprints\//.test(m[0]))process.exit(1);if(!/import contract/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] sub-graph state schema 含 contractImported field
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/contractImported:\s*Annotation/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h13-import-contract-artifacts.test.js')"

## Learning

文件: docs/learnings/cp-0509221411-h13-import-contract-artifacts.md

## 测试命令

```bash
npx vitest run tests/brain/h13-import-contract-artifacts.test.js
```
