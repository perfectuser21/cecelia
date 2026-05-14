---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 子目录检测集成测试

**范围**: `packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js`（新增，不 mock `node:fs/promises`，用真实 tmp 目录）
**大小**: S（约 120 行，单文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 集成测试文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js'))process.exit(1)"

- [ ] [ARTIFACT] 文件不 import vi.mock 对 node:fs/promises（真实 fs 验证核心）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js','utf8');if(c.includes(\"vi.mock('node:fs/promises')\"))process.exit(1)"

- [ ] [ARTIFACT] 文件包含 parsePrdNode 和 defaultReadContractFile 两个 import
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js','utf8');if(!c.includes('parsePrdNode')||!c.includes('defaultReadContractFile'))process.exit(1)"

- [ ] [ARTIFACT] 文件包含 os.tmpdir() 调用（真实 tmp 目录）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js','utf8');if(!c.includes('tmpdir'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] parsePrdNode 子目录 happy path — sprintDir 返回 'sprints/w45-b34-e2e'
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js --reporter=verbose 2>&1 | grep -qE "✓.*parsePrdNode.*happy path|✓.*sprintDir.*w45-b34-e2e"'
  期望: exit 0

- [ ] [BEHAVIOR] parsePrdNode 返回的 prdContent 与写入文件内容字面一致
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js --reporter=verbose 2>&1 | grep -qE "✓.*prdContent|✓.*literal"'
  期望: exit 0

- [ ] [BEHAVIOR] defaultReadContractFile 子目录扫描返回正确合同内容
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js --reporter=verbose 2>&1 | grep -qE "✓.*defaultReadContractFile|✓.*contract.*subdir"'
  期望: exit 0

- [ ] [BEHAVIOR] defaultReadContractFile 合同缺失时 throw 含 "contract file not found"
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js --reporter=verbose 2>&1 | grep -qE "✓.*contract file not found|✓.*throws"'
  期望: exit 0

- [ ] [BEHAVIOR] 全套集成测试 0 failed（所有 4 场景绿灯）
  Test: manual:bash -c 'cd /workspace && RESULT=$(npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js --reporter=verbose 2>&1); echo "$RESULT"; echo "$RESULT" | grep -qE "0 failed|Tests.*passed"'
  期望: exit 0
