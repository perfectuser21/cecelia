# DoD: Brain 区分进程健康 vs 系统全局内存压力

- [x] [ARTIFACT] platform-utils.js 新增 evaluateMemoryHealth + getBrainRssMB
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!c.includes('export function evaluateMemoryHealth'))process.exit(1);if(!c.includes('export function getBrainRssMB'))process.exit(2);"

- [x] [BEHAVIOR] evaluateMemoryHealth 区分 Brain RSS vs 系统可用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!c.includes('brain_memory_ok'))process.exit(1);if(!c.includes('system_memory_ok'))process.exit(2);"

- [x] [BEHAVIOR] Brain RSS > 1500MB 触发 halt（真泄漏场景）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!c.includes('BRAIN_RSS_DANGER_MB = 1500'))process.exit(1);if(!c.includes(\"'halt'\"))process.exit(2);"

- [x] [BEHAVIOR] slot-allocator getBackpressureState 接入 memory_health
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!c.includes('system-low but Brain-fine'))process.exit(1);if(!c.includes('memory_health.action'))process.exit(2);"

- [x] [BEHAVIOR] platform-utils evaluateMemoryHealth 单测覆盖 4 种组合
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/platform-utils.test.js','utf8');if(!c.includes('scenario 1:'))process.exit(1);if(!c.includes('scenario 4:'))process.exit(2);if(!c.includes('evaluateMemoryHealth'))process.exit(3);"

- [x] [ARTIFACT] executor.js checkServerResources 降级系统低+Brain正常为 warn
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('memory warn (not halting)'))process.exit(1);"

- [x] [ARTIFACT] Learning 文件记录根因 + 场景表
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04180907-brain-memory-health-evaluator.md','utf8');if(!c.includes('根本原因'))process.exit(1);if(!c.includes('场景表格'))process.exit(2);"
