# DoD — fleet heartbeat 可信度修复 (B7)

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/fleet-resource-cache.js` 含 `HEARTBEAT_OFFLINE_GRACE_MIN` env 读取
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!c.includes('HEARTBEAT_OFFLINE_GRACE_MIN'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/fleet-resource-cache.js` 的 `getFleetStatus()` 返回 `last_ping_at` 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!c.includes('last_ping_at'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/fleet-resource-cache.js` 含 `offline_reason` 逻辑，值含 `fetch_failed` 和 `no_ping_grace_exceeded`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!c.includes('fetch_failed')||!c.includes('no_ping_grace_exceeded'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/__tests__/fleet-heartbeat.test.js` 测试文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/fleet-heartbeat.test.js')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] 5 分钟内有成功采集 → online=true, offline_reason=null
  Test: tests/packages/brain/fleet-heartbeat.test.js 或 packages/brain/src/__tests__/fleet-heartbeat.test.js

- [x] [BEHAVIOR] 10+ 分钟无成功采集 → online=false, offline_reason=no_ping_grace_exceeded
  Test: packages/brain/src/__tests__/fleet-heartbeat.test.js

- [x] [BEHAVIOR] 首次采集失败 → online=false, offline_reason=fetch_failed
  Test: packages/brain/src/__tests__/fleet-heartbeat.test.js
