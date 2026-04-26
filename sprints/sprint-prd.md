# Sprint PRD — Brain /api/brain/build-info 端点

## OKR 对齐

- **对应 KR**：Harness v9 zero-babysit 终极测试链路（Brain 全自动 Phase A → 完成）
- **当前进度**：v8 在 P0-final 修之前创建，Gen ABORT；v9 在 P0-final 全部修后从 Phase A 起步
- **本次推进预期**：验证 Brain harness_mode=true 全自动跑通最小可观测端点

## 背景

需要一个轻量、零依赖的诊断端点，让外部（dashboard / CI / 运维）能直接读取当前运行的 Brain 实例的构建身份（git SHA、包版本、启动时刻），无需查 db、无需进容器、无需查 git log。这是 v9 zero-babysit 链路的最小验收载荷：足够小到 Generator 一次出图，足够独立到不污染现有路由，足够可观测到 Evaluator 能机械验证。

## 目标

暴露 `GET /api/brain/build-info`，返回当前 Brain 实例的构建身份三元组 `{git_sha, package_version, built_at}`，启动后稳定不变。

## User Stories

**US-001**（P0）: 作为运维，我希望 `curl localhost:5221/api/brain/build-info` 返回 200 + JSON 三字段，以便快速确认线上跑的是哪个 commit / 哪个包版本 / 何时启动。

**US-002**（P0）: 作为监控系统，我希望 `built_at` 在进程启动时一次性确定并缓存，以便两次请求返回值完全相同（用于检测进程是否被重启）。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Brain 进程已启动并挂载 build-info 路由
- When 客户端发起 `GET /api/brain/build-info`
- Then 响应 status=200，Content-Type=application/json，body 仅包含 `git_sha` / `package_version` / `built_at` 三个键

**场景 2**（US-002）:
- Given Brain 进程已启动
- When 客户端在 1 秒内连续两次发起 `GET /api/brain/build-info`
- Then 两次响应中的 `built_at` 字段完全相等（字符串严格相等）

**场景 3**（US-001 边界）:
- Given Brain 进程在没有 git 历史的环境启动（git 命令不可用 / 不在 git 仓库）
- When 客户端发起 `GET /api/brain/build-info`
- Then 响应仍返回 200，`git_sha` 字段值为字符串 `"unknown"`

**场景 4**（US-001 一致性）:
- Given Brain 进程已启动
- When 客户端发起 `GET /api/brain/build-info`
- Then `package_version` 字段的值与 `packages/brain/package.json` 的 `version` 字段完全相等

## 功能需求

- **FR-001**: 提供 Express Router 模块，导出可被 server.js 挂载的路由对象
- **FR-002**: 路由响应 GET 请求，返回 JSON 三字段 `{git_sha, package_version, built_at}`
- **FR-003**: `git_sha` 在 git 命令失败 / 不可用时回退为字符串 `"unknown"`
- **FR-004**: `built_at` 在模块加载时一次性确定，后续请求返回缓存值
- **FR-005**: server.js 在 `/api/brain/build-info` 路径挂载该路由

## 成功标准

- **SC-001**（[ARTIFACT]）: 文件 `packages/brain/src/routes/build-info.js` 存在且导出 Express Router
- **SC-002**（[ARTIFACT]）: `packages/brain/src/server.js` 通过 `app.use('/api/brain/build-info', ...)` 挂载该路由
- **SC-003**（[BEHAVIOR]）: supertest GET `/api/brain/build-info` 返回 200，body 含且仅含三键
- **SC-004**（[BEHAVIOR]）: `body.package_version === require('packages/brain/package.json').version`
- **SC-005**（[BEHAVIOR]）: `body.built_at` 通过 ISO 8601 格式校验（`new Date(body.built_at).toISOString() === body.built_at`）
- **SC-006**（[BEHAVIOR]）: 同一进程内两次请求 `body.built_at` 严格相等

## 假设

- [ASSUMPTION: 现有 server.js 已使用 Express 框架且支持 `app.use(path, router)` 挂载方式]
- [ASSUMPTION: 测试运行环境已安装 supertest（基于 packages/brain/package.json 中存在 supertest 依赖）]
- [ASSUMPTION: 当前 git_sha 通过子进程同步执行 `git rev-parse HEAD` 获取，失败时 catch 后回退 'unknown']

## 边界情况

- git 不可用 / 当前目录非 git 仓库 → `git_sha` = `"unknown"`，端点仍返回 200
- 客户端在端点挂载前发起请求 → 由 Express 默认 404 处理（不在本端点责任内）
- 进程重启后 `built_at` 会更新（这是预期行为，用于检测重启）

## 范围限定

**在范围内**:
- 创建 `packages/brain/src/routes/build-info.js` Express Router 模块
- 在 `packages/brain/src/server.js` 挂载路由
- 编写 supertest 集成测试覆盖 4 个验收场景

**不在范围内**:
- 不连接 db.js / pg pool
- 不引入新依赖（仅使用 Node.js 内置 child_process + 已有 supertest）
- 不增加鉴权 / 限流 / 缓存头
- 不暴露其他构建元数据（如 node 版本、依赖版本树）
- 不在 dashboard 增加可视化（dashboard 工作不属于本 Initiative）

## 预期受影响文件

- `packages/brain/src/routes/build-info.js`: 新建，Express Router 模块
- `packages/brain/src/server.js`: 修改，挂载新路由
- `packages/brain/src/__tests__/build-info.test.js`: 新建，supertest 集成测试
