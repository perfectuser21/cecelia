task_id: 582a24f2-5ba0-4753-89bc-1657deda54d3
branch: cp-0426100009-fix-propose-branch-fallback-582a24f2

## 任务标题

[Brain Harness] propose_branch 抽取失败时 fallback 用 cp-MMDDHHmm-<taskId8>

## 任务描述

`packages/brain/src/workflows/harness-gan.graph.js` 的 `extractProposeBranch` 在 SKILL 漏输出
propose_branch JSON 时返回 null，导致 `contract.branch=null` → sub-task `payload.contract_branch=空` →
Generator ABORT，Initiative 卡死在最后一跳。

本 PR 在 proposer 节点处加 fallback：抽不到时用 `cp-${shanghaiTimestamp}-${taskId.slice(0,8)}`，
新增 `fallbackProposeBranch(taskId, now)` helper（Asia/Shanghai 时区，MMDDHHmm 格式，与 worktree-manage.sh 风格一致）。

## DoD

- [x] [ARTIFACT] harness-gan.graph.js 已 export `fallbackProposeBranch`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/export function fallbackProposeBranch/.test(c))process.exit(1)"

- [x] [ARTIFACT] proposer 节点已用 `||  fallbackProposeBranch(taskId)` 兜底
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/extractProposeBranch\(result\.stdout\)\s*\|\|\s*fallbackProposeBranch\(taskId\)/.test(c))process.exit(1)"

- [x] [BEHAVIOR] `fallbackProposeBranch('582a24f2-...', new Date('2026-04-26T10:09:00Z'))` → `cp-04261809-582a24f2`（Asia/Shanghai 时区正确）
  Test: manual:node -e "const {fallbackProposeBranch}=require('./packages/brain/src/workflows/harness-gan.graph.js');const out=fallbackProposeBranch('582a24f2-5ba0-4753-89bc-1657deda54d3', new Date('2026-04-26T10:09:00.000Z'));if(out!=='cp-04261809-582a24f2'){console.error('got',out);process.exit(1)}"

- [x] [BEHAVIOR] proposer stdout 缺 propose_branch 时 runGanContractGraph 返回值 propose_branch 非 null 且匹配 `^cp-\d{8}-<taskId8>$`
  Test: packages/brain/src/__tests__/harness-gan-graph.test.js

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0426100009-fix-propose-branch-fallback-582a24f2.md')"

## 目标文件

- packages/brain/src/workflows/harness-gan.graph.js
- packages/brain/src/__tests__/harness-gan-graph.test.js
- docs/learnings/cp-0426100009-fix-propose-branch-fallback-582a24f2.md
- DoD.md
