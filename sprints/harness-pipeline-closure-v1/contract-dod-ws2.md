# Contract DoD — Workstream 2: Post-Merge 实现（contract 校验 + worktree 清理 + Brain 回写）

- [ ] [BEHAVIOR] harness_post_merge 处理时校验 sprint contract 的 DoD 条目达标情况
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('contract')&&!c.includes('dod'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 清理已合并 WS 的 worktree 目录和临时 git 分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('worktree')&&!c.includes('git branch -D')&&!c.includes('git worktree remove'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 回写 Brain 任务状态为 completed 并更新 OKR
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('completed'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 最后创建 harness_report 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('harness_report'))process.exit(1);console.log('PASS')"
