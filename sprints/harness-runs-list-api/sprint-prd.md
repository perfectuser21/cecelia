# PRD：GET /api/brain/harness/runs 列表接口

## 目标

Brain 新增 GET /api/brain/harness/runs 接口，查 initiative_runs 表返回最近 pipeline 运行记录列表。

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/runs'`
- [x] [BEHAVIOR] GET /api/brain/harness/runs 返回 JSON 数组
  Test: `tests/harness-runs-api.test.ts`
- [x] [BEHAVIOR] ?limit=0 和 ?limit=abc 返回 HTTP 400
  Test: `manual:node -e "const assert=require('assert');const src=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');assert(src.includes(\"limit < 1 || limit > 100\"),'limit validation missing');console.log('ok')"`
- [x] [BEHAVIOR] 单元测试覆盖 6 场景（默认limit/limit=5/空表/limit=0/limit=101/limit=abc/字段校验）
  Test: `packages/brain/src/routes/__tests__/harness.test.js`
