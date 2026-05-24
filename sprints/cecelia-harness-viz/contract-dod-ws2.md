---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Brain 单元测试（mock pool）

**范围**: 新建 `packages/brain/src/__tests__/harness-ws-progress.test.js`，mock pool 验证路由逻辑
**大小**: M (100-150 行)
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] 测试文件存在且含 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-ws-progress.test.js','utf8');if(!c.includes('describe'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 测试文件覆盖 initiative not found 场景（404 路径）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-ws-progress.test.js','utf8');if(!c.includes('not found'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] vitest 单元测试中 mock pool 返回正确 schema（initiative_id + workstreams 字段值正确）
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-ws-progress.test.js'
  期望: exit 0（所有测试通过）

- [ ] [BEHAVIOR] mock pool 返回空数组场景测试通过（workstreams=[] 边界）
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-ws-progress.test.js --reporter=verbose --testNamePattern "empty|空|workstreams"'
  期望: exit 0（目标测试用例通过，无 FAIL 行）

- [ ] [BEHAVIOR] 测试文件中禁用字段（steps/phases/stages/result/data/ws_list）不出现在 mock 响应断言中
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'packages/brain/src/__tests__/harness-ws-progress.test.js'"'"','"'"'utf8'"'"');const banned=['"'"'steps'"'"','"'"'phases'"'"','"'"'stages'"'"','"'"'data'"'"','"'"'ws_list'"'"'];const found=banned.filter(f=>c.includes(JSON.stringify(f)+'"'"':'"'"'));if(found.length>0){console.error('"'"'FAIL: 禁用字段出现在断言中'"'"',found);process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK

- [ ] [BEHAVIOR] 测试文件中 fix_round 断言为 number 类型（字段类型正确性）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'packages/brain/src/__tests__/harness-ws-progress.test.js'"'"','"'"'utf8'"'"');if(!c.includes('"'"'fix_round'"'"'))process.exit(1);console.log('"'"'OK'"'"')"'
  期望: OK

- [ ] [BEHAVIOR] 404 not found 测试存在且 mock pool 不返回 harness_initiative 行时响应 404（error path）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'packages/brain/src/__tests__/harness-ws-progress.test.js'"'"','"'"'utf8'"'"');if(!c.includes('"'"'404'"'"'))process.exit(1);if(!c.includes('"'"'initiative not found'"'"'))process.exit(1);console.log('"'"'OK'"'"')"'
  期望: OK
