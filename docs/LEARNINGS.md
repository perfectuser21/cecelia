
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

---

### [2026-01-19] AI 员工功能 - n8n 工作流抽象

**任务**: 将 n8n 工作流抽象成「AI 员工」概念，按部门组织展示

**Bug**: 无严重问题

**技术要点**:
1. 使用 `workflowKeywords` 数组匹配工作流名称到员工职能
2. API 聚合层复用 n8n-live-status API，按员工 ID 过滤和统计
3. 员工卡片组件支持展开/收起交互，显示职能范围和最近任务

**优化点**:
1. PR Gate Hook 的质检报告格式要求 `layers.L1_automated.status` 等字段，初次容易写错
2. auto-backup 会在写代码过程中自动提交，可能导致 commit 历史混乱，建议在开始前暂停 auto-backup
3. 前端页面需要登录才能验证效果，Layer 2 验证受限

**影响程度**: Low

---

### [2026-01-19] AI 员工页面加载问题修复

**任务**: 修复 AI 员工页面无限转圈问题

**Bug**: 前端 `fetchAiEmployeesWithStats()` 调用 `/api/v1/n8n-live-status/instances/local/overview` API，但该 API 在 autopilot 后端不存在，导致页面一直显示 loading 状态。

**解决方案**: 修改 API 层，在后端 API 未实现前直接返回静态配置数据（员工卡片显示，统计为 0）。

**技术要点**:
1. 新功能开发时，应先确认依赖的后端 API 是否存在
2. 前端应实现 graceful degradation - API 失败时显示默认数据而非无限加载
3. 使用 `try-catch` 包裹 API 调用，catch 中返回默认值

**优化点**:
1. 开发流程应包含"API 可用性检查"步骤
2. 前端组件应有 error boundary 或 fallback UI
3. 可以考虑在 config 文件中标记"依赖的后端 API"，方便追踪

**影响程度**: Medium - 页面完全无法使用

---

### [2026-01-19] AI 员工界面改进 - 图标统一 + 折叠面板

**任务**: 替换 emoji 为统一图标，改为折叠面板，添加详情页

**Bug**: 无

**技术要点**:
1. 使用 `IconName` 类型约束图标名称，通过 `DynamicIcon` 组件动态渲染 lucide 图标
2. 部门折叠面板使用 useState 控制展开状态，defaultExpanded 支持默认展开第一个
3. 详情页路由使用 `:employeeId` 和 `:abilityId` 参数，通过 useParams 获取
4. 职能详情页的"手动运行"按钮暂用 alert 提示，等后端 API 实现后再对接

**优化点**:
1. 用 Subagents 并行创建多个详情页组件可以提高效率
2. 删除不再使用的组件（如 AiEmployeeCard）保持代码整洁

**影响程度**: Low
