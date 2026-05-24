---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain 单元测试（mock pool）

**范围**: 新建 `packages/brain/src/__tests__/harness-ws-progress.test.js`，mock pool 验证路由逻辑
**大小**: M (100-150 行)
**依赖**: Workstream 1

## ARTIFACT 条目

- [x] [ARTIFACT] 测试文件存在且含 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-ws-progress.test.js','utf8');if(!c.includes('describe'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 测试文件覆盖 initiative not found 场景（404 路径）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-ws-progress.test.js','utf8');if(!c.includes('not found'))process.exit(1);console.log('OK')"
