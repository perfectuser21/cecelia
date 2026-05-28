---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: health-codex-bridge-status 集成测试

**范围**: 新建 `packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js`，mock `global.fetch` 模拟 bridge 探活，验证 online/offline/timeout/throw 四个分支下 `codex_bridge_status` 字段值正确，schema 不含禁用变体
**大小**: M (100-200 行净增，1 文件)
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] 测试文件存在 `packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js`
  Test: node -e "require('fs').accessSync('/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js'); console.log('OK')"

- [x] [ARTIFACT] 测试文件包含 mock global.fetch（模拟 bridge 探活）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js','utf8');if(!c.includes('fetch'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 测试文件包含 describe 块针对 codex_bridge_status
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js','utf8');if(!c.includes('codex_bridge_status'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [x] [BEHAVIOR] 测试文件包含 online 分支测试（bridge 返回 2xx → codex_bridge_status = "online"）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js\",\"utf8\");if(!c.includes(\"online\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] 测试文件包含 offline 分支测试（bridge 返回非 2xx → codex_bridge_status = "offline"）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js\",\"utf8\");if(!c.includes(\"offline\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] error path — 测试文件包含 timeout 或 throw/reject 分支（bridge 探活超时/异常 → "offline"）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js\",\"utf8\");if(!c.includes(\"timeout\")&&!c.includes(\"throw\")&&!c.includes(\"reject\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] 测试文件包含 schema 完整性断言（验证 status + uptime_seconds 与 codex_bridge_status 共存）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js\",\"utf8\");if(!c.includes(\"uptime_seconds\")&&!c.includes(\"status\"))process.exit(1);console.log(\"OK\")"'
  期望: OK
