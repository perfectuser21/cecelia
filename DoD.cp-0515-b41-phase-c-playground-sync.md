# DoD — B41: Phase C finalEvaluateDispatchNode 同步 playground/ 到 origin/main

## 问题描述

Phase C evaluator (IS_FINAL_E2E=true) 测试 initiative worktree 里的 playground/ 代码。
initiative worktree HEAD 停在 GAN 合同分支，Phase B PR 合并到 main 后，
Phase C 若不先同步，evaluator 永远测旧代码 → Final E2E 永远 FAIL。

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js` 存在，包含 B41 playground sync 测试
  Test: `node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js')"`

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 `finalEvaluateDispatchNode` 包含 `git checkout origin/main -- playground/`
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('checkout\', \'origin/main\', \'--\', \'playground/\''))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] B41 playground sync：worktreePath 非 null 时，finalEvaluateDispatchNode 在 spawn executor 前调用 git fetch + git checkout origin/main -- playground/
  Test: tests/packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js

- [x] [BEHAVIOR] B41 playground sync：worktreePath 为 null 时跳过 git 操作，不抛错
  Test: tests/packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js
