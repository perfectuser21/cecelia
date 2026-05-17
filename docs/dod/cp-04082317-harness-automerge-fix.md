# DoD: fix(harness): 移除 auto-merge --auto 旗标

## 问题
`shepherd.js` 中 `executeMerge()` 调用 `gh pr merge --squash --auto`。
`--auto` 旗标需要 GitHub 仓库开启 branch protection + auto-merge 功能，
否则命令静默失败（exit 0 但 PR 不合并），导致：
- PR 永远 OPEN
- deploy.yml 不触发
- harness_deploy_watch 超时（5分钟后）才创建 harness_report
- 代码实际未合并到 main

## 修复
移除 `--auto`，改为直接 `gh pr merge --squash`。
Harness ci_watch 已确认 CI 全通过才创建 evaluate，evaluate PASS 时 CI 已全绿，直接 squash merge 可立即成功。

## DoD

- [x] [ARTIFACT] shepherd.js executeMerge 不含 `--auto` 旗标
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(c.includes('--auto'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] gh pr merge 调用格式正确
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes('--squash'))process.exit(1);if(c.includes('--auto'))process.exit(1);console.log('PASS')"`
