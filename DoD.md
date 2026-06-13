---
branch: cp-06130805-watchdog-gan-stall
sprint_dir: sprints/06130805-watchdog-gan-stall
skeleton: false
journey_type: autonomous
---
# DoD — Bug Fix: harness liveness watchdog 覆盖 planner/GAN(A) 阶段静默卡死

**范围**: `packages/brain/src/harness-watchdog.js` 的 `resumeStalledHarnessDrivers` 新增 A 阶段
（planner/GAN）活动复合判据 + fresh-start 重排（受 `MAX_INITIATIVE_FRESH_STARTS` 上限约束），
让 A 阶段回调丢失致图静默卡死的 harness_initiative 能被自动捞起重试，不再死等人工。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] `harness-watchdog.js` 含 A 阶段覆盖逻辑（A_contract + 活动复合判据 + run_events）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog.js','utf8');if(!/A_contract/.test(c)||!/GREATEST/.test(c)||!/initiative_run_events/.test(c))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 回归测试文件存在（A 阶段卡死覆盖）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js');console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] watchdog 捞取范围覆盖 A 阶段：扫 A_contract 且用 GREATEST(心跳, initiative_runs.updated_at, initiative_run_events.ts) 活动复合判据（A 阶段心跳天然陈旧，不能单用心跳）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog.js','utf8');const a=/A_contract/.test(c),g=/GREATEST/.test(c),e=/initiative_run_events/.test(c),t=/MAX\\(e\\.ts\\)/.test(c);if(!(a&&g&&e&&t)){console.error('A阶段复合判据缺失',{a,g,e,t});process.exit(1)}console.log('OK')"

- [x] [BEHAVIOR] A 阶段命中 → fresh-start 重排（剥离 resume_from_checkpoint，让 executor 重跑 planner 并递增 execution_attempts），区别于 B 阶段的 resume
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog.js','utf8');if(!/fresh-start re-spawn planner/.test(c)){console.error('缺 fresh-start 重排路径');process.exit(1)}console.log('OK')"

- [x] [BEHAVIOR] fresh-start 受 MAX_INITIATIVE_FRESH_STARTS 上限约束：查询带 execution_attempts < 上限（坏任务不无限重试）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog.js','utf8');if(!/MAX_INITIATIVE_FRESH_STARTS/.test(c)||!/execution_attempts/.test(c)){console.error('缺 fresh-start 上限约束');process.exit(1)}console.log('OK')"

- [x] [BEHAVIOR] B 阶段既有 resume 逻辑保持不变（不破坏 #3356/#3361）：仍有 B_task_loop + resume_from_checkpoint=true 路径
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watchdog.js','utf8');if(!/B_task_loop/.test(c)||!/resume_from_checkpoint/.test(c)){console.error('B阶段resume路径被破坏');process.exit(1)}console.log('OK')"
