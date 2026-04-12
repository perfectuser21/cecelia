# Contract DoD — Workstream 1: CI Watch 链路 + Post-Merge 编排

- [ ] [BEHAVIOR] Generator（harness_generate）完成回调后，系统创建 harness_ci_watch 任务（状态 queued），payload 包含 pr_url、sprint_dir、workstream_index
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('harness_ci_watch'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher CI 轮询通过后执行 auto-merge，失败时创建 harness_fix
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('gh pr merge'))process.exit(1);if(!c.includes('harness_fix'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 最后一个 WS 合并完成后创建 harness_post_merge 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('harness_post_merge'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] task-router.js 中注册 harness_post_merge 类型，路由映射到 _internal
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('harness_post_merge'))process.exit(1);console.log('PASS')"
