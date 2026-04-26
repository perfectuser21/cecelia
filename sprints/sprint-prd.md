# Sprint PRD — Brain build-info 端点

## OKR 对齐

- **对应 KR**：Sprint 2（Phase B/C LangGraph 后端到端验证）
- **当前进度**：Sprint 1 已完成（PR #2640），Sprint 2 起步
- **本次推进预期**：建立可观测性基线，后续 Sprint 验收依赖此端点判断 Brain 实际运行版本

## 背景

Sprint 1 完成 Phase B/C 全链路进 LangGraph（PR #2640），新代码已合入 main。此后端到端验证需要一种**可远程查询 Brain 当前实际运行版本**的方式：当前线上跑的 git_sha 是哪个、package version 是什么、什么时候构建的。这是新代码上线后第一次端到端验证的可观测性前置条件。

## 目标

提供 `GET /api/brain/build-info` 端点，返回当前进程的 git_sha、package_version、built_at 三个字段，供运维与回归验证使用。

## User Stories

- **US-001**（P0）: 作为 Brain 运维者，我希望调用一个 HTTP 端点就能确认线上 Brain 进程当前跑的代码版本与构建时间，以便判断部署是否生效、回归来自哪个版本。
- **US-002**（P1）: 作为 CI / 回归验收者，我希望 build-info 的 package_version 与代码仓库 package.json 中声明的版本严格一致，以便自动化判定版本同步状态。

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 端点可用）:
- Given Brain 进程已启动，server.js 已挂载 `/api/brain/build-info`
- When supertest 发起 `GET /api/brain/build-info`
- Then 响应状态码 = 200，且 body 同时包含 `git_sha`、`package_version`、`built_at` 三个键

**场景 2**（US-002 — 版本同步）:
- Given Brain 在当前代码上构建启动
- When 调用 `/api/brain/build-info`
- Then `body.package_version` 严格等于 `packages/brain/package.json` 中的 `version` 字段值

**场景 3**（built_at 格式合法）:
- Given Brain 进程已启动
- When 调用 `/api/brain/build-info`
- Then `body.built_at` 是合法的 ISO 8601 时间字符串（`new Date(body.built_at).toISOString()` 不抛错且与原值等价）

## 功能需求

- **FR-001**: 提供独立的 Express Router 模块 `packages/brain/src/routes/build-info.js`，导出 router。
- **FR-002**: `server.js` 顶部 `import` 该 router，并以 `app.use('/api/brain/build-info', buildInfoRoutes)` 形式挂载（与现有路由风格一致）。
- **FR-003**: GET `/` 路径返回 JSON `{ git_sha, package_version, built_at }`。
- **FR-004**: `package_version` 来源必须能追溯到 `packages/brain/package.json` 的 `version` 字段（运行时从 package.json 读取，避免硬编码）。
- **FR-005**: `built_at` 必须为 ISO 8601 格式字符串。
- **FR-006**: `git_sha` 字段始终存在（即便仓库信息不可得也应有 fallback 值，例如 `"unknown"`），不能为 `undefined`。

## 成功标准

- **SC-001**: supertest 集成测试覆盖三个 BEHAVIOR DoD 全部通过
- **SC-002**: 端点 200 响应中三个字段全部为非空字符串
- **SC-003**: 端点不破坏现有 server.js 启动流程（保持原有路由可用）

## 假设

- [ASSUMPTION: 测试框架沿用 brain 包现有 vitest + supertest 组合（已在 package.json 中可见 vitest 配置）]
- [ASSUMPTION: `git_sha` 在容器/CI 构建环境可通过环境变量或 `git rev-parse HEAD` 取得；具体获取方式由实现层决定，PRD 不规定]
- [ASSUMPTION: `built_at` 在进程启动时（模块加载时）一次性确定，请求时返回该固定值]

## 边界情况

- **git 信息不可得**（非 git 仓库 / shallow clone / 容器内没有 .git）：返回 `git_sha` 为 fallback 字符串（如 `"unknown"`），不抛错
- **package.json 读取失败**：极端兜底，但正常构建下不应出现；测试不强制覆盖
- **并发请求**：本端点为只读、值在启动时确定，无并发问题

## 范围限定

**在范围内**:
- 新增 `packages/brain/src/routes/build-info.js`
- 修改 `packages/brain/server.js` 挂载新路由
- 编写 supertest 集成测试覆盖三个 BEHAVIOR DoD

**不在范围内**:
- Dashboard / 前端展示 build-info
- 用 build-info 替换 brain-manifest 等已有版本端点
- 自动化部署脚本中调用 build-info 校验
- 把 git_sha 注入容器构建参数的 CI 改造（实现层若需要可以做，但不是 PRD 必须项）

## 预期受影响文件

- `packages/brain/src/routes/build-info.js`: 新增 — Express Router，导出 GET / 处理函数
- `packages/brain/server.js`: 新增 import + `app.use('/api/brain/build-info', ...)` 挂载（参照第 207-260 行附近现有路由块）
- `packages/brain/test/`（或现有测试目录）: 新增 supertest 测试文件覆盖 3 个 BEHAVIOR DoD
- `packages/brain/package.json`: 仅 version 字段被读取，无需修改
