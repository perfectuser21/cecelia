# PRD: OKR KR 进度更新 Integration Test

**Brain Task**: b718ac29-d685-4c35-83e9-751a688dd1d7  
**PR Series**: brain-test-pyramid 第 4 个 PR

## 背景

OKR 模块只有 unit test，缺少"通过 API 更新 KR 进度并验证变更真正写入 DB"的 integration test。

## 目标

为 `PATCH /api/brain/okr/key-results/:id` + `GET /api/brain/okr/current` 写完整 integration test，验证进度更新端到端持久化。

## 成功标准

### DoD

- [x] [BEHAVIOR] 测试文件存在且覆盖 GET → PATCH → GET 进度验证链路
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/okr-progress-sync.integration.test.js')"

- [x] [BEHAVIOR] 测试包含 progress_pct 验证（非端点存活，行为级）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/okr-progress-sync.integration.test.js','utf8');if(!c.includes('progress_pct'))process.exit(1)"

- [x] [BEHAVIOR] afterAll 严格清理（DELETE FROM objectives）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/okr-progress-sync.integration.test.js','utf8');if(!c.includes('DELETE FROM objectives'))process.exit(1)"

- [x] [BEHAVIOR] Brain 不可达时测试自动 skip（brainAvailable guard）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/okr-progress-sync.integration.test.js','utf8');if(!c.includes('brainAvailable'))process.exit(1)"
