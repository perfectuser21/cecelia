# DoD: dispatcher HOL blocking fix

**Branch**: cp-05121200-dispatcher-hol-skip

## Definition of Done

- [x] [ARTIFACT] dispatcher.js 包含 `MAX_SKIP_HEAD_FOR_BLOCKED` 常量
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!c.includes('MAX_SKIP_HEAD_FOR_BLOCKED'))process.exit(1)"`

- [x] [ARTIFACT] dispatcher.js 包含 `hol_skip_cap_exceeded` 错误码
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!c.includes('hol_skip_cap_exceeded'))process.exit(1)"`

- [x] [ARTIFACT] dispatcher.js 包含 `holSkipIds` 变量
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!c.includes('holSkipIds'))process.exit(1)"`

- [x] [BEHAVIOR] C1: 队首 codex P1 task + codex pool 满 + 第二位 dev task → 派 dev task
  Test: tests/dispatcher-hol.test.js

- [x] [BEHAVIOR] C2: 队首 P0 codex task + codex pool 满 → 全停 (reason=codex_pool_full)
  Test: tests/dispatcher-hol.test.js

- [x] [BEHAVIOR] C3: skip cap 触发 → reason=hol_skip_cap_exceeded
  Test: tests/dispatcher-hol.test.js

- [x] [BEHAVIOR] 已有 dispatcher 测试全部继续通过
  Test: tests/dispatcher-initiative-lock.test.js
