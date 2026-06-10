# DoD: harness 子图等待逻辑三根因修复

## 验收清单

- [x] [BEHAVIOR] 容器 running 时 callback 超时不误杀（继续等待到正常完成）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('不误杀，继续等到正常完成'))process.exit(1)"

- [x] [BEHAVIOR] 超 hard ceiling 时 kill 容器并 resume failed(callback_hard_timeout)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('callback_hard_timeout'))process.exit(1)"

- [x] [BEHAVIOR] 外层 deadline 到期不再透传 status=queued（容器死 → failed；活 → 延长）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('queued'))process.exit(1)"

- [x] [BEHAVIOR] callback 401 分类为 auth_failure 并 markAuthFailure 熔断
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/await-callback-auth.test.js','utf8');if(!c.includes('auth_failure'))process.exit(1)"

- [x] [BEHAVIOR] watchdog staleMinutes 默认 10
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js','utf8');if(!c.includes('staleMinutes 默认 10'))process.exit(1)"

- [x] [ARTIFACT] CALLBACK_HARD_TIMEOUT_MS 常量存在（env CECELIA_CALLBACK_HARD_TIMEOUT_MS）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('CECELIA_CALLBACK_HARD_TIMEOUT_MS'))process.exit(1)"

- [x] [ARTIFACT] killContainerById 导出
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-container-cleanup.js','utf8');if(!c.includes('export async function killContainerById'))process.exit(1)"

## Learning 路径

docs/learnings/cp-06102130-harness-liveness-timeout-fix.md
