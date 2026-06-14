---
skeleton: false
journey_type: autonomous
---
# Contract DoD — GAN 子图 thread_id + proposer 分支按 attempt 版本化

**范围**: harness-gan.graph.js（ganThreadIdFor/proposeBranchFor/proposer/runGanContractGraph）+ harness-initiative.graph.js（runGanLoopNode 读 execution_attempts 传 attemptN）+ 测试。不改 watchdog/dbUpsert/B59-idem 逻辑。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] harness-gan.graph.js 导出 ganThreadIdFor 与 proposeBranchFor
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('export function ganThreadIdFor')||!c.includes('export function proposeBranchFor'))process.exit(1)"

- [x] [ARTIFACT] regression 测试文件存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-gan-thread-attempt.test.js','utf8');if(!c.includes('ganThreadIdFor')||!/describe|it\(/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 真实 node 进程/退出码）

- [x] [BEHAVIOR] GAN 子图 thread_id 带 attemptN 版本（不同 attempt 不同 thread；attemptN 缺省归一 0）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/workflows/harness-gan.graph.js').then(m=>{const a=m.ganThreadIdFor('t',0),b=m.ganThreadIdFor('t',2);if(a!==('t:gan:0'))process.exit(1);if(a===b)process.exit(1);if(m.ganThreadIdFor('t')!=='t:gan:0')process.exit(1)})"
  期望: exit 0（`t:gan:0` 格式 + 不同 attempt 不同 thread + 缺省归一 0）

- [x] [BEHAVIOR] proposer 分支带 -a${attemptN}，不同 attempt 不同分支（B59-idem 不跨 attempt 复用旧合同）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/workflows/harness-gan.graph.js').then(m=>{const b0=m.proposeBranchFor('abcd1234-x',1,0),b2=m.proposeBranchFor('abcd1234-x',1,2);if(b0!=='cp-harness-propose-r1-abcd1234-a0')process.exit(1);if(b0===b2)process.exit(1);if(!/^cp-harness-propose-/.test(b2))process.exit(1)})"
  期望: exit 0（带 -a0 后缀 + 不同 attempt 不同 + 仍 cp-harness-propose- 前缀）

- [x] [BEHAVIOR] runGanLoopNode 从 tasks.execution_attempts 读 attemptN 传入 runGanContractGraph（读失败 fallback 0）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/SELECT execution_attempts FROM tasks/.test(c))process.exit(1);if(!/attemptN,/.test(c))process.exit(1)"
  期望: exit 0（读 execution_attempts + attemptN 传入 GAN）
