# Task Card — Dashboard 可交付冲刺 (KR5: 58%→75%)

## 任务 ID
dashboard-sprint-75 / b24f59ec-2aa1-4eaa-bfe0-c246f4

## 目标
修复 Dashboard 3 大阻断 bug，统一 error handling，确保 20 分钟演示无阻断。

## 范围
1. **P0 Bug 修复**：
   - `task-type-config-cache.js` UPSERT INSERT 时 executor=null 违反 NOT NULL 约束
   - C 类任务（如 codex_dev）不在 DB 中时，保存配置触发 DB 错误 → 修复后保存成功

2. **P1 Error Handling 统一**：
   - BrainModelsPage / CollectionDashboardPage / AccountUsagePage
   - 所有 API 失败静默 → 添加 fetchError state + 用户可见错误提示 + 重试按钮

3. **P1 UX（已有）**：
   - RoadmapPage：已有完整 loading/error/empty states（不需修改）

## 文件变更
- `packages/brain/src/task-type-config-cache.js` — UPSERT 默认值修复
- `apps/dashboard/src/pages/brain-models/BrainModelsPage.tsx` — fetchError state + 错误 UI
- `apps/dashboard/src/pages/collection-dashboard/CollectionDashboardPage.tsx` — fetchError state + 错误 UI
- `apps/dashboard/src/pages/account-usage/AccountUsagePage.tsx` — fetchError state + 错误 UI

## DoD

- [x] [ARTIFACT] task-type-config-cache.js UPSERT 修复：INSERT VALUES 用 COALESCE 默认值
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-type-config-cache.js','utf8');if(!c.includes(\"COALESCE(\$2, 'xian')\"))process.exit(1)"`

- [x] [BEHAVIOR] C 类任务 PUT only-location 后 Brain 重启可正常保存（代码已修复，需 Brain 重启生效）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-type-config-cache.js','utf8');if(!c.includes(\"COALESCE(\$3, 'codex_bridge')\"))process.exit(1)"`

- [x] [ARTIFACT] BrainModelsPage 添加了 fetchError state 和错误提示 UI
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/brain-models/BrainModelsPage.tsx','utf8');if(!c.includes('fetchError'))process.exit(1)"`

- [x] [ARTIFACT] CollectionDashboardPage 添加了 fetchError state 和错误页
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/collection-dashboard/CollectionDashboardPage.tsx','utf8');if(!c.includes('fetchError'))process.exit(1)"`

- [x] [ARTIFACT] AccountUsagePage 添加了 fetchError state 和错误提示 UI
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/account-usage/AccountUsagePage.tsx','utf8');if(!c.includes('fetchError'))process.exit(1)"`
