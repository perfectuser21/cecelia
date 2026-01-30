
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

### [2026-01-23] AI 员工页面接入实时 API

**任务**: 将 AI 员工页面从静态数据改为调用 n8n-live-status API 获取实时统计

**Bug**: 无

**技术要点**:
1. `fetchLiveStatus('local')` 返回实时执行数据，包含 runningExecutions 和 recentCompleted
2. 使用 `Map<employeeId, stats>` 按员工聚合统计，避免 O(n²) 嵌套循环
3. try-catch 实现 graceful degradation，API 失败时返回默认数据

**优化点**:
1. 代码改动集中在一个文件，职责清晰
2. 错误处理使用 console.error 记录日志便于调试

**影响程度**: Low - 功能增强，无破坏性变更

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

---

### [2026-01-29] Brain Action Loop - Tick 机制

**任务**: 实现定时自动推进机制，让 Brain 每隔 30 分钟自动检查状态并执行动作

**Bug**: 分支命名不符合 Hook 规范 (`F-BRAIN-*` 不在 `cp-*` 或 `feature/*` 中)，需要重新创建分支为 `cp-brain-action-loop`

**技术要点**:
1. Tick 机制依赖 Daily Focus - 只处理与今日焦点相关的任务
2. 决策逻辑：无 in_progress 任务时，自动开始下一个 queued 任务
3. Stale 检测：in_progress 超过 24 小时的任务被标记为 stale
4. 使用 working_memory 存储 tick 状态（enabled、last_tick、actions_today）
5. 所有 tick 动作自动记录到 decision_log 表

**优化点**:
1. 分支命名规范需要更清晰文档化（cp-* 或 feature/*）
2. Tick 模块复用了 focus.js 的 getDailyFocus() 和 actions.js 的 updateTask()，代码复用良好
3. 测试覆盖了 15 个场景，包括状态管理、任务推进、stale 检测、focus 集成

**影响程度**: Low - 功能增强，无破坏性变更

---

### [2026-01-30] Organ Unification Phase 1 - 聚合层强化

**任务**: 为 workspace 添加系统状态聚合和审计中间件

**Bug**: 
1. CI 失败 - `npm ci` 要求 package-lock.json 与 package.json 同步，但我们用 pnpm 安装了 supertest，未更新 package-lock.json
2. 解决方案：运行 `npm install --package-lock-only` 更新 lock 文件

**技术要点**:
1. 聚合层模式 - /api/system/status 并行请求 brain、quality、workflows 状态
2. 带超时的 fetch - 使用 AbortController 设置 5 秒超时，避免慢服务阻塞响应
3. 服务降级 - catch 块中返回 `{ health: 'unavailable' }` 而非抛异常
4. 审计中间件 - 异步写入数据库，不阻塞请求响应
5. 测试使用 vitest + supertest，通过 mockFetch 模拟外部服务

**优化点**:
1. 项目使用 pnpm，但 CI 使用 npm ci - 需要同时维护两套 lock 文件
2. L3 建议：可以提取 fetchWithTimeout 为公共模块（当前各文件各自实现）

**影响程度**: Low - 新增功能，无破坏性变更

---

### [2026-01-30] KR1: Headless /dev Session with Memory Summary

**任务**: 实现无头模式的 /dev 会话管理，自动记录到 Memory 并生成结构化 Summary

**Bug**:
1. track.sh 被 Hook 保护，无法直接修改 - 该文件属于 zenithjoy-engine 仓库
2. .quality-gate-passed 被 .gitignore 忽略，不会被提交

**技术要点**:
1. Session ID 格式 `dev_YYYYMMDD_HHMMSS_xxxxxx` 使用 crypto random suffix 保证唯一性
2. Episodic memory 层存储 session 数据，key 格式 `dev_session_{sessionId}` 和 `summary_{sessionId}`
3. Quality gate 验证三要素：QA-DECISION.md 存在、AUDIT-REPORT.md 有 Decision: PASS、.quality-gate-passed 存在
4. Panorama command-center 需要改为 async 以支持 queryDevSessions 异步调用
5. API 端点设计：遵循 RESTful 规范，使用 POST 创建、PATCH 更新、GET 查询

**优化点**:
1. routes.ts 文件较大（添加了约 230 行），L3 建议拆分为独立路由文件
2. Session tracking 可以通过 API 实现，不必修改 track.sh
3. 测试使用集成测试（调用实际 API）而非 mock，验证更真实

**影响程度**: Low - 新增功能模块，无破坏性变更
