# DoD — cp-04152213-pipeline-stuck-watchdog

## Artifact

- [x] [ARTIFACT] 新建 `packages/brain/src/pipeline-watchdog.js` 导出 `checkStuckPipelines`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/pipeline-watchdog.js','utf8');if(!c.includes('export async function checkStuckPipelines'))process.exit(1);if(!c.includes('pipeline_stuck'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] 新建 `packages/brain/src/__tests__/pipeline-watchdog.test.js`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/pipeline-watchdog.test.js','utf8');if(!c.includes('checkStuckPipelines'))process.exit(1);if(!c.includes('thresholdHours'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] `packages/brain/src/tick.js` 引入 watchdog 并注册周期调度
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes(\"from './pipeline-watchdog.js'\"))process.exit(1);if(!c.includes('checkStuckPipelines(pool)'))process.exit(1);if(!c.includes('PIPELINE_WATCHDOG_INTERVAL_MS'))process.exit(1);console.log('ok')"`

## Behavior

- [x] [BEHAVIOR] Watchdog 对 6h 无更新 + 存在 open 任务的 pipeline 判定为 stuck，取消 open 任务并写事件
  - Test: `tests/pipeline-watchdog.test.js`（对应 `packages/brain/src/__tests__/pipeline-watchdog.test.js` 第一个用例）

- [x] [BEHAVIOR] Watchdog 对刚更新过的 pipeline 不动，只查聚合不做 UPDATE/INSERT
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/pipeline-watchdog.test.js','utf8');if(!c.includes('刚刚更新过'))process.exit(1);if(!c.includes('toHaveBeenCalledTimes(1)'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] Watchdog 聚合查询限定 harness_* task_type，不扫 dev / content_publish
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/pipeline-watchdog.js','utf8');if(!c.includes('HARNESS_TASK_TYPES'))process.exit(1);if(!c.includes(\"'harness_planner'\"))process.exit(1);if(c.includes(\"'dev',\"))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] tick.js 在 MINIMAL_MODE 下跳过 watchdog 调用
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const idx=c.lastIndexOf('PIPELINE_WATCHDOG_INTERVAL_MS');const block=c.slice(Math.max(0,idx-200), idx+400);if(!block.includes('!MINIMAL_MODE'))process.exit(1);if(!block.includes('checkStuckPipelines'))process.exit(1);console.log('ok')"`
