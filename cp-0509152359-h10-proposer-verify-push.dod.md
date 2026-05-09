# DoD: H10 proposer 节点 verify origin push

## 验收清单

- [ ] [BEHAVIOR] proposer 节点 origin verify 失败时 throw Error 含 'proposer_didnt_push'
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [BEHAVIOR] proposer 节点 origin verify 通过时正常 return propose_branch
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [BEHAVIOR] proposer 节点原有 exit_code≠0 throw 'proposer_failed' 行为保留
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [ARTIFACT] harness-gan.graph.js 含 import fetchAndShowOriginFile + LLM_RETRY + 'proposer_didnt_push' 字面量 + addNode 带 retryPolicy: LLM_RETRY
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/fetchAndShowOriginFile/.test(c))process.exit(1);if(!/LLM_RETRY/.test(c))process.exit(1);if(!/proposer_didnt_push/.test(c))process.exit(1);if(!/addNode\('proposer'[^)]+retryPolicy/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h10-proposer-verify-push.test.js')"

## Learning

文件: docs/learnings/cp-0509152359-h10-proposer-verify-push.md

## 测试命令

```bash
npx vitest run tests/brain/h10-proposer-verify-push.test.js
```
