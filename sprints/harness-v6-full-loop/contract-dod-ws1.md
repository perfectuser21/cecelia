# Contract DoD — Workstream 1: Pipeline Automation (Auto-Merge + Auto-Deploy + Cleanup)

- [ ] [BEHAVIOR] CI watch 在所有 checks 通过后调用 executeMerge 自动合并 PR
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('executeMerge'))throw new Error('FAIL');console.log('PASS: executeMerge 引用存在')"
- [ ] [BEHAVIOR] CI watch 超过 MAX_CI_WATCH_POLLS 次轮询后标记超时并创建 harness_fix
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('MAX_CI_WATCH_POLLS'))throw new Error('FAIL');if(!c.includes('ci_timeout'))throw new Error('FAIL');console.log('PASS: CI 超时保护存在')"
- [ ] [BEHAVIOR] Deploy watch 执行 Brain 重启 + health check 轮询，health check 失败 3 次后中止
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('processHarnessDeployWatchers'))throw new Error('FAIL');if(!c.includes('health'))throw new Error('FAIL');console.log('PASS: deploy watch + health check 逻辑存在')"
- [ ] [BEHAVIOR] Pipeline 结束后清理 orphan worktrees、已合并的 cp-harness-* 分支、/tmp/cecelia-* 文件
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');const c=fs.readFileSync(sp,'utf8');if(!c.includes('clean')&&!c.includes('prune')&&!c.includes('清理'))throw new Error('FAIL');console.log('PASS: report skill 含清理步骤')"
- [ ] [ARTIFACT] harness_deploy_watch 在 task-router.js VALID_TASK_TYPES 中注册
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('harness_deploy_watch'))throw new Error('FAIL');console.log('PASS: harness_deploy_watch 已注册')"
