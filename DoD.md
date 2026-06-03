# DoD：GAN 熔断/真terminal 在 error 带 terminal:true（Wave 2c）

Brain task: 0285439b-0b79-493f-8218-ce961fe2077b
分支: cp-06031001-gan-terminal-flag

## 背景

B58 在 resume 端加了 `error?.terminal===true` 钩子，但没人 set terminal → 熔断（硬停）仍要白白
消耗满 MAX_INITIATIVE_FRESH_STARTS=3 才停。本 PR 让真·terminal 的熔断点在 error 对象带
`terminal:true`，并沿 runGanContractGraph→runGanLoopNode→checkpoint 透传，使 B58 钩子第一次中止即
标 failed 停（省 N−1 次无谓重启）。transient infra（proposer_failed/reviewer_failed exit≠0）不标，
继续靠 B58 全局上限兜底重试。

## 改动

- [x] [ARTIFACT] proposer no-push streak / reviewer no-verdict streak / GAN budget 熔断的 error 对象带 `terminal: true`（budget 由裸 throw 改为 return error 走统一 ganAborted 路径；runReviewerSchemaLoop 自身的 budget throw 不在本 PR 范畴，保留）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');const m=c.match(/terminal: true/g)||[];if(m.length<3)process.exit(1);if(!/message: msg, terminal: true/.test(c))process.exit(1)"

- [x] [BEHAVIOR] runGanLoopNode catch：熔断（err.ganAborted 或 err.terminal）→ 返回 error.terminal=true；transient 裸 throw → falsy
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/err\.terminal === true \|\| err\.ganAborted === true/.test(c))process.exit(1);if(!/node: 'gan', message: err\.message, terminal: isTerminal/.test(c))process.exit(1)"

- [x] [BEHAVIOR] runGanContractGraph re-throw 把 terminal 带到抛出的 error 上；serial gate + terminalFail 也标 terminal
  Test: manual:node -e "const g=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/e\.terminal = finalState\.error\.terminal === true/.test(g))process.exit(1);const i=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/node: 'terminal_fail', message: reason, terminal: true/.test(i))process.exit(1)"

## 验收

- [x] failing test 先写后绿：harness-gan-terminal-flag.test.js（3）+ harness-initiative-terminal-flag.test.js（5），共 8 用例先红后绿
- [x] transient 对照：SC-302（普通 throw 无 ganAborted）→ error.terminal falsy（让 cap 兜底，不误标）
- [x] 既有 harness-gan-graph / harness-initiative-gan-base-repo / harness-schema-validation 全绿，无回归
- [x] **未碰 Wave 2b**：节点 catch→error→END 范式 / interrupt() 节点 / 嵌套子图 resume，一律未动
- [x] Brain 版本四处同步 bump（1.230.17 → 1.230.18）
- [x] DevGate 通过（facts-check / version-sync）
