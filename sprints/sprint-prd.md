# Sprint PRD — Brain `/api/brain/build-info` 端点

## OKR 对齐

- **对应 KR**：Harness v9 zero-babysit 验证（运维可观测性 KR）
- **当前进度**：Phase A 起步（基于 P0-final 修复后的全新代码）
- **本次推进预期**：交付一个最小、可独立验证的只读端点，证明 Harness 全自动闭环（PRD → DAG → Gen → CI → Merge）能跑通

## 背景

v8（576f6cf4）在 P0-final 修复前创建，contract 没 branch、sub-task 也缺 `contract_branch`，导致 Generator ABORT。v9 用 P0-final 全部修复后的新代码从 Phase A 起步，期望全自动跑通，因此选择一个尽可能小、依赖尽量少的端点（不连 db / 不连 pg pool）作为终极烟囱测试。

## 目标

Brain 暴露一个只读 HTTP 端点 `GET /api/brain/build-info`，返回当前进程的构建身份信息：`git_sha`、`package_version`、`built_at`。

## User Stories

- **US-001**（P0）：作为运维或自动化巡检脚本，我希望 `curl localhost:5221/api/brain/build-info` 返回 200 + JSON 三字段，以便快速判断当前 Brain 跑的是哪个版本。
- **US-002**（P0）：作为客户端，我希望 `built_at` 在进程生命周期内稳定（启动时缓存一次，后续请求值相同），以便用它做"实例重启检测"。

## 验收场景（Given-When-Then）

**场景 1**（US-001 主路径）:
- Given Brain 进程已启动
- When 客户端发起 `GET /api/brain/build-info`
- Then 收到 HTTP 200，响应体是 JSON 对象，**仅**包含三个键：`git_sha`、`package_version`、`built_at`

**场景 2**（US-002 缓存一致性）:
- Given Brain 进程启动后未重启
- When 客户端先后两次调用 `GET /api/brain/build-info`
- Then 两次响应的 `built_at` 字段值完全相同

**场景 3**（package_version 准确性）:
- Given Brain 已加载 `packages/brain/package.json`
- When 客户端调用端点
- Then `body.package_version` 严格等于 `require('../../package.json').version` 的值

**场景 4**（git_sha fallback）:
- Given 运行环境无法读取 git SHA（例如不在 git 仓库中）
- When 客户端调用端点
- Then `body.git_sha === 'unknown'`，且端点仍返回 200

## 功能需求

- **FR-001**：在 `packages/brain/src/routes/` 下新增一个 Express Router 模块，导出默认 router；router 上挂载 `GET /` handler
- **FR-002**：handler 返回 JSON `{ git_sha, package_version, built_at }` 三字段，无其他多余键
- **FR-003**：`built_at` 在模块加载（即进程启动）时一次性生成，后续请求复用同一值
- **FR-004**：`built_at` 是合法的 ISO 8601 字符串
- **FR-005**：`git_sha` 在无法读取时回退为字符串 `'unknown'`（不抛异常）
- **FR-006**：`package_version` 来自 `packages/brain/package.json` 的 `version` 字段
- **FR-007**：`packages/brain/server.js` 引入该 router 并挂载到 `/api/brain/build-info` 路径下

## 成功标准

- **SC-001**【ARTIFACT】：`packages/brain/src/routes/build-info.js` 存在，`export default` 是 Express Router 实例
- **SC-002**【ARTIFACT】：`packages/brain/server.js` 含有 `app.use('/api/brain/build-info', ...)` 挂载语句
- **SC-003**【BEHAVIOR】：supertest 对挂载后的 app 发 `GET /api/brain/build-info` 返回 200，响应体键集合等于 `['git_sha','package_version','built_at']`
- **SC-004**【BEHAVIOR】：`body.package_version` 严格等于 `package.json` 的 `version` 字段
- **SC-005**【BEHAVIOR】：`body.built_at` 是合法 ISO 8601 字符串（可被 `new Date(...)` 解析且 `toISOString()` 等于自身）
- **SC-006**【BEHAVIOR】：连续两次请求返回的 `body.built_at` 完全相等
- **SC-007**【BEHAVIOR】：当 git SHA 读取失败时，`body.git_sha === 'unknown'`

## 假设

- [ASSUMPTION：harness_mode=true 已由 Brain 控制台开启，Generator 全自动执行无需人工介入]
- [ASSUMPTION：仓库根目录通常在 git working tree 内；测试环境若无 .git 也必须通过 fallback]
- [ASSUMPTION：`packages/brain/package.json` 始终存在且包含 `version` 字段（monorepo 标准结构）]

## 边界情况

- 进程不在 git 仓库中（或 .git 缺失）→ `git_sha = 'unknown'`，端点仍 200
- 多次并发请求 → 全部返回相同的 `built_at`（仅启动时算一次）
- 重复调用端点不应触发任何 git 命令重跑（性能要求隐含）

## 范围限定

**在范围内**:
- 新建 `packages/brain/src/routes/build-info.js` 路由模块
- 在 `packages/brain/server.js` 挂载到 `/api/brain/build-info`
- supertest 单元/集成测试（覆盖三字段、缓存一致、fallback、ISO 格式）

**不在范围内**:
- 不连接 `db.js` / pg pool（端点保持 stateless）
- 不写鉴权、不接 internalAuth 中间件（这是公开只读端点）
- 不暴露 build_id / commit_message / build_host 等扩展字段
- 不更新 dashboard / 前端展示
- 不写 OpenAPI / API 文档

## 预期受影响文件

- `packages/brain/src/routes/build-info.js`（新增）：Router 实现
- `packages/brain/server.js`（修改）：import + `app.use('/api/brain/build-info', buildInfoRoutes)`
- `packages/brain/src/__tests__/routes/build-info.test.js`（新增）：supertest 测试
