# Task Card: 数据采集v1 - 多平台集成与验证

**任务 ID**: d33d49cd-3ac5-471d-8e2e-875f776dd160  
**分支**: cp-04060821-d33d49cd-3ac5-471d-8e2e-875f77

## DoD

- [x] [ARTIFACT] `packages/brain/src/routes/analytics.js` 新增 `collection-dashboard` 路由
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/analytics.js','utf8');if(!c.includes('/analytics/collection-dashboard'))process.exit(1)"`

- [x] [BEHAVIOR] GET /api/brain/analytics/collection-dashboard 返回 normality_rate + platforms 数组
  - Test: `tests:packages/brain/src/__tests__/collection-dashboard.test.js`

- [x] [BEHAVIOR] 测试覆盖：有数据/无数据/DB 错误 3 个场景均通过
  - Test: `tests:packages/brain/src/__tests__/collection-dashboard.test.js`
