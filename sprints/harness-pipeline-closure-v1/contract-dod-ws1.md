# Contract DoD — Workstream 1: CI Watch 链路修复 + Post-Merge 全实现

- [ ] [BEHAVIOR] harness_generate 最后 WS 回调不再 inline 调 checkPrCiStatus，改为创建 harness_ci_watch 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('currentWsIdx === totalWsCount');const s=c.substring(idx,idx+2000);if(s.includes('checkPrCiStatus')){console.log('FAIL: 仍有 inline CI 检查');process.exit(1)}if(!s.includes('harness_ci_watch')){console.log('FAIL: 未创建 ci_watch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness_ci_watch 通过后创建 harness_post_merge（而非直接 harness_report）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf('ci_passed');const s=c.substring(i,i+2000);if(!s.includes('harness_post_merge')){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] post_merge 清理已合并 WS 的 worktree（实际 exec 调用，非注释）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!/exec(?:Sync)?\s*\([^)]*worktree/s.test(c)){console.log('FAIL: 无 worktree 清理 exec 调用');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] post_merge 回写 planner 任务状态为 completed 并创建 harness_report
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf('post_merge');if(i===-1){console.log('FAIL: 无 post_merge 段');process.exit(1)}const s=c.substring(i,i+3000);if(!s.includes('planner_task_id')||!s.includes('completed')){console.log('FAIL: 缺 planner 回写');process.exit(1)}if(!s.includes('harness_report')){console.log('FAIL: 缺 report 创建');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] harness_post_merge 在 VALID_TASK_TYPES 数组中注册且有 LOCATION_MAP 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const a=c.substring(c.indexOf('['),c.indexOf('];'));if(!a.includes(\"'harness_post_merge'\")){console.log('FAIL: VALID_TASK_TYPES 未注册');process.exit(1)}if(!c.substring(c.indexOf('LOCATION_MAP')).includes('harness_post_merge')){console.log('FAIL: LOCATION_MAP 未注册');process.exit(1)}console.log('PASS')"
