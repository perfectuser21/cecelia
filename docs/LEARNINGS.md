
### [2026-01-19] Autopilot 导航结构重构

**任务**: 将侧边栏从按 Feature 分组改为按场景分组（工作台/新媒体运营/设置）

**Bug**: 无严重问题

**技术要点**:
1. `MediaScenarioPage` 使用 React Router 的嵌套 `<Routes>` 实现内部 Tab 路由
2. 场景页内部子路由通过 `path="content/*"` 方式捕获，避免路由冲突
3. 旧路由使用 `additionalRoutes` 配置重定向保持兼容性

**优化点**:
1. PR Gate Hook 的 `.quality-report.json` 格式需要严格遵循（layers.L1_automated 等字段名）
2. 开发环境需要飞书 OAuth 才能验证登录后的 UI，建议增加 mock 登录功能

**影响程度**: Low
