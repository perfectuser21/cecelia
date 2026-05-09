# DoD: H8 evaluator 切到 generator 的 task worktree

## 验收清单

- [x] [BEHAVIOR] harnessTaskWorktreePath(taskId) 返回 <baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId> 路径
  Test: tests/brain/h8-evaluator-worktree.test.js

- [x] [BEHAVIOR] evaluateSubTaskNode 传给 executor 的 worktreePath = harnessTaskWorktreePath(state.task.id)，不再是 state.worktreePath
  Test: tests/brain/h8-evaluator-worktree.test.js

- [x] [BEHAVIOR] evaluateSubTaskNode 幂等门保留（state.evaluate_verdict 非空时直接 return，不调 executor）
  Test: tests/brain/h8-evaluator-worktree.test.js

- [x] [ARTIFACT] harness-worktree.js 含 export function harnessTaskWorktreePath + export const DEFAULT_BASE_REPO
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/export function harnessTaskWorktreePath/.test(c))process.exit(1);if(!/export const DEFAULT_BASE_REPO/.test(c))process.exit(1)"

- [x] [ARTIFACT] evaluateSubTaskNode 函数体含 harnessTaskWorktreePath 调用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function evaluateSubTaskNode[\s\S]+?\n\}/);if(!m||!m[0].includes('harnessTaskWorktreePath'))process.exit(1)"

## Learning

文件: docs/learnings/cp-0509144710-h8-evaluator-worktree-switch.md

## 测试命令

```bash
npx vitest run tests/brain/h8-evaluator-worktree.test.js
```
