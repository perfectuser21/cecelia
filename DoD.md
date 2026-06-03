# DoD — harness merge_pr BEHIND 限次重试 + CONFLICTING 诊断终止

Brain task: 9dbc9222-6076-4af5-85ce-96ea35efef33
分支: cp-06031135-harness-mergepr-behind-conflict

## 背景

harness 子任务 PR 由 sub-graph `merge_pr` 节点自管（shepherd 不碰）。`mergePrNode` 原 update-branch
逻辑有两缺口：(1) `rebase_attempted` 当布尔用，churn 反复 BEHIND 时第二次即放弃；(2) CONFLICTING
真冲突被 BEHIND_RE 误判 → update-branch 解不了 → reason 含糊还浪费 CI 轮次。

## 改动

- [x] [ARTIFACT] `MAX_REBASE_ATTEMPTS = 3` 常量 + `queryMergeState` 权威状态查询存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('MAX_REBASE_ATTEMPTS'))process.exit(1);if(!c.includes('queryMergeState'))process.exit(1)"

- [x] [BEHAVIOR] BEHIND churn 计数器递增重试 + 达上限带 reason 终止 + CONFLICTING 诊断终止
  Test: packages/brain/src/__tests__/harness-task-verdict.test.js

- [x] [BEHAVIOR] 源码含计数器递增与 conflicting/rebase_exhausted 两个诊断 reason
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/rebase_attempted: attempts \+ 1/.test(c))process.exit(1);if(!/reason: 'conflicting'/.test(c))process.exit(1);if(!/reason: 'rebase_exhausted'/.test(c))process.exit(1)"

## 验收

- [x] failing test 先写后绿：harness-task-verdict.test.js 新增 3 用例（churn 计数器 / 达上限终止 / CONFLICTING 终止）先红后绿
- [x] 原有 mergePrNode 用例无回归（18 passed）；harness-task.graph + b21-merge-pr-auto 全绿（52 passed）
- [x] **未碰** generator 门禁 / error→END / resume 范式（终止仍走现有 error→END）
- [x] DevGate 通过（facts-check / version-sync）
