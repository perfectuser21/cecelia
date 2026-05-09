# DoD: H11 sub-task worktree key 用 <init8>-<logical_id> 复合

## 验收清单

- [ ] [BEHAVIOR] harnessSubTaskWorktreePath(init, logical) 返回 task-<init8>-<logical> 路径
  Test: tests/brain/h11-subtask-worktree-key.test.js

- [ ] [BEHAVIOR] ensureHarnessWorktree opts.wtKey 优先于 shortTaskId(taskId) 计算路径
  Test: tests/brain/h11-subtask-worktree-key.test.js

- [ ] [BEHAVIOR] ensureHarnessWorktree 配 wtKey 时接受短 taskId 不 throw
  Test: tests/brain/h11-subtask-worktree-key.test.js

- [ ] [BEHAVIOR] sub-graph spawnNode 调 ensureWt 时 opts.wtKey = `<init8>-<logical>`
  Test: tests/brain/h11-subtask-worktree-key.test.js

- [ ] [BEHAVIOR] evaluateSubTaskNode worktreePath = harnessSubTaskWorktreePath(initiativeId, sub_task.id)
  Test: tests/brain/h11-subtask-worktree-key.test.js

- [ ] [ARTIFACT] harness-worktree.js export harnessSubTaskWorktreePath + harnessSubTaskBranchName + ensureHarnessWorktree 含 wtKey
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/export function harnessSubTaskWorktreePath/.test(c))process.exit(1);if(!/export function harnessSubTaskBranchName/.test(c))process.exit(1);if(!/opts\.wtKey/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h11-subtask-worktree-key.test.js')"

## Learning

文件: docs/learnings/cp-0509173457-h11-subtask-worktree-key.md

## 测试命令

```bash
npx vitest run tests/brain/h11-subtask-worktree-key.test.js
```
