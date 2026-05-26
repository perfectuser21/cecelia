# DoD: fix(harness) — worktree cleanup after merge + periodic stale cleanup

## Branch
cp-0526172922-harness-worktree-cleanup

## Changes

- [x] [BEHAVIOR] mergePrNode calls cleanupHarnessWorktree after successful PR merge
  Test: tests:packages/brain/src/workflows/__tests__/harness-task.graph.test.js

- [x] [BEHAVIOR] mergePrNode skips cleanup when worktreePath is null
  Test: tests:packages/brain/src/workflows/__tests__/harness-task.graph.test.js

- [x] [ARTIFACT] cleanupStaleHarnessWorktrees exported from harness-worktree.js
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!c.includes('export async function cleanupStaleHarnessWorktrees'))process.exit(1);console.log('ok')"

- [x] [BEHAVIOR] tick-runner calls cleanupStaleHarnessWorktrees every 20 minutes
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('cleanupStaleHarnessWorktrees'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] SUBGRAPH_POLL_INTERVAL_MS default is 30000 (30s)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes(\"'30000'\"))process.exit(1);console.log('ok')"
