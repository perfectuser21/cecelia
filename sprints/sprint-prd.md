# Sprint PRD — 新增 GET /api/brain/ping 端点（Generator PR 产出验证）

## OKR 对齐

- **对应 KR**：KR-Harness 自愈闭环可用 / Generator Docker 产出验证
- **当前进度**：[ASSUMPTION: Brain API 不可达，无法读取精确百分比]
- **本次推进预期**：完成后 Generator 节点在 Docker 容器内 git push + PR 创建链路获得最小可观测冒烟验证，把"pr_url=null 死循环"盲区补上最薄的一层 smoke test
- **说明**：本任务是刻意最小化的"线路测试"，不承担任何业务价值；其 KR 贡献体现在"证实 Generator 能真正 push 并产出 PR"，而非端点本身功能

## 背景

近期（参考 PRD.cp-0419190439-harness-generator-prurl-fix.md）LangGraph harness pipeline 暴露 Generator 容器内 git 不可用、extractField 把 `"null"` 当成有效 URL 的静默失败链路。修复合入后需要一个**最小、单文件、单路由**的任务，作为端到端冒烟：让 Generator 在 Docker 容器内真正改一行代码、git push、返回真实 PR URL。若本任务的 PR 产出成功，说明修复链路生效；若仍返回 `null`，说明残留根因尚未清理。

## 目标

在 `packages/brain/src/routes/brain.js` 新增 `GET /api/brain/ping` 端点，返回固定 JSON `{pong: true, timestamp: "<ISO-8601 UTC>"}`，用于冒烟测试 Generator 的 PR 产出能力。

## User Stories

**US-001**（P0）: 作为 harness 运维，我希望有一个零业务逻辑的最小端点任务，以便验证 Generator 在 Docker 容器内是否真的能 git push 并产出合法 PR URL（而不是 `null`/`"FAILED"`）。

**US-002**（P1）: 作为健康探针调用方（如外部监控 / uptime 探活），我希望请求 `GET /api/brain/ping` 得到 200 + `{pong: true, timestamp}`，以便粗粒度确认 Brain 进程存活与时钟合理。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001 / US-002）— 正常响应:
- **Given** Brain 服务已启动，监听 `localhost:5221`
- **When** 发起 `GET /api/brain/ping`（无认证、无参数）
- **Then** 响应 HTTP 200，`Content-Type: application/json`，body 为 `{"pong": true, "timestamp": "<ISO-8601 字符串>"}`

**场景 2**（关联 US-002）— timestamp 为当前时间:
- **Given** Brain 服务正常运行
- **When** 两次调用 `GET /api/brain/ping` 间隔 ≥ 1 秒
- **Then** 两次返回的 `timestamp` 字段不同，且均可被 `new Date(ts)` 成功解析为现在 ±1 分钟以内

**场景 3**（关联 US-001）— Generator PR 产出验证:
- **Given** harness pipeline 派发本任务给 Generator（Docker 容器执行）
- **When** Generator 完成开发并返回
- **Then** `extractField` 读到非 `null`、非 `"FAILED"`、形如 `https://github.com/<owner>/<repo>/pull/<n>` 的 pr_url，且对应分支在远端存在

## 功能需求

- **FR-001**: 在 `packages/brain/src/routes/brain.js` 注册路由 `router.get('/ping', handler)`，挂载后实际路径为 `/api/brain/ping`（假设 app.js 以 `/api/brain` 前缀挂 `brain.js` 的 router —— [ASSUMPTION: 依照项目现有 `/api/brain/context` 路由命名惯例推断]）
- **FR-002**: handler 返回 `res.json({ pong: true, timestamp: new Date().toISOString() })`，HTTP 200
- **FR-003**: 不读取任何数据库、外部服务、环境变量；不依赖 auth 中间件（保持"最简"本意）
- **FR-004**: 不增加新依赖、不修改 package.json

## 成功标准

- **SC-001**: 本地启动 Brain 后，`curl -s localhost:5221/api/brain/ping` 输出合法 JSON，`.pong === true`，`.timestamp` 可被 `Date.parse()` 解析
- **SC-002**: Generator 产出的 PR URL 形如 `https://github.com/<owner>/<repo>/pull/<number>`（非 `null`、非 `"FAILED"`、非空串），且对应 `cp-*` 分支在远端存在
- **SC-003**: 该 PR 改动仅涉及 `packages/brain/src/routes/brain.js` 一个文件、≤ 10 行净增
- **SC-004**: PR 通过 CI 基础检查（lint / 现有测试不被破坏）

## 假设

- [ASSUMPTION: `/api/brain/*` 在 `app.js` 以 `app.use('/api/brain', brainRouter)` 方式挂载 —— 由其他 PRD 引用的 `/api/brain/context` 端点推断]
- [ASSUMPTION: `packages/brain/src/routes/brain.js` 文件存在且已有其他 GET 路由（如 `/context`），因此新增 `/ping` 只需在同文件再添一个 handler]
- [ASSUMPTION: Brain 进程默认监听端口 5221（由本次 Step 0 `curl localhost:5221/api/brain/context` 约定推断）]
- [ASSUMPTION: 项目无强制 auth 中间件，或现有 `/api/brain/context` 同样无 auth；若实际被 auth 拦截，新增端点应绕过或声明豁免]
- [ASSUMPTION: 由于 Brain API 在执行 Planner 的容器中不可达（`curl` exit 7），本次 Step 0 未能拉取活跃 OKR/任务/决策上下文；假设没有与"新增冒烟端点"冲突的在飞任务]

## 边界情况

- **并发**: 端点无状态，并发调用安全（仅 `new Date()`）
- **时钟偏移**: 容器时钟异常时 `timestamp` 可能偏离真实 UTC；本任务不做时钟校正（不在范围内）
- **异常输入**: GET 请求无参数；若携带 query / body 一律忽略
- **方法不匹配**: POST/PUT 等应由 Express 默认返回 404 或 405，不在本任务范围内特殊处理
- **JSON 序列化失败**: 理论上不可能（两个原生字面量），无需兜底

## 范围限定

**在范围内**:
- 在 `packages/brain/src/routes/brain.js` 新增单个 `GET /ping` handler
- handler 只返回 `{pong: true, timestamp: <ISO>}`
- 通过此 PR 冒烟验证 Generator Docker 容器 git push + PR URL 产出链路

**不在范围内**:
- 单元测试 / 集成测试新增（本任务刻意最小化；冒烟由"PR 真实存在"本身承担）
- OpenAPI / docs 更新
- 鉴权、限流、日志、metrics
- 路由挂载代码（`app.js` / 挂载 prefix）的修改
- 其他 `/api/brain/*` 端点重构
- Dockerfile / entrypoint / CI 调整

## 预期受影响文件

（Brain API 不可达，以下基于项目 PRD 历史中对 `packages/brain/src/routes/*.js` 的引用推断，Proposer 在合同阶段验证实际路径）

- `packages/brain/src/routes/brain.js`：新增 `router.get('/ping', ...)` handler；预计净增 ≤ 5 行
