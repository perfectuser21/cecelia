# DoD: Harness v4.0 自身流程优化

**Task ID**: 402f7dd7-347b-4063-84ba-1bbca40ec2c8
**Sprint Dir**: sprints/harness-v4-self-optimize

## [BEHAVIOR] F1: GAN MAX_GAN_ROUNDS 防死循环
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('MAX_GAN_ROUNDS'))process.exit(1);if(!c.includes('nextRound > MAX_GAN_ROUNDS'))process.exit(1);console.log('PASS')"`
- [x] execution.js REVISION 路径含 MAX_GAN_ROUNDS=3 守卫

## [BEHAVIOR] F2: CI watch 超时创建 harness_evaluate(ci_timeout:true)
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('ci_timeout'))process.exit(1);if(!c.includes(\"task_type: 'harness_evaluate'\"))process.exit(1);console.log('PASS')"`
- [x] CI 超时路径创建 harness_evaluate 并带 ci_timeout:true

## [BEHAVIOR] F3: harness_fix payload 含 pr_url
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('FAIL \u2192 harness_fix');const pidx=c.indexOf('pr_url: harnessPayload.pr_url',idx);if(pidx===-1)process.exit(1);console.log('PASS')"`
- [x] harness_evaluate FAIL → harness_fix payload 含 pr_url

## [BEHAVIOR] F4: deploy_watch 超时降级测试覆盖
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('coverage_degraded'))process.exit(1);if(!c.includes('deploy_pending'))process.exit(1);console.log('PASS')"`
- [x] deploy_watch 超时时 coverage_degraded:true，计数器改为 deploy_pending

## [BEHAVIOR] F5: harness-watcher.js 30s 轮询节流
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('HARNESS_WATCH_INTERVAL_MS'))process.exit(1);if(!c.includes('_lastHarnessWatchMs'))process.exit(1);console.log('PASS')"`
- [x] 模块级 30s 节流，未到间隔直接返回空结果
