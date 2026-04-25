# Sprint PRD — Brain Health 探针端点

## OKR 对齐

- **对应 KR**：KR-免疫系统健康度（Brain 服务可观测性）
- **当前进度**：[ASSUMPTION: 未取到 Brain context API，按经验估 ~60%]
- **本次推进预期**：~5%（补齐对外可探测的运行时心跳）

## 背景

当前 Brain 服务（端口 5221）对外没有一个**统一的、轻量的、不依赖数据库**的健康探针端点。
监控、负载均衡器、selfcheck 巡检脚本只能依赖业务接口（如 `/api/brain/context`）来推断存活，
一旦数据库或业务子系统降级，外部观察者无法区分"进程死了"和"进程活着但部分功能降级"。

本 Initiative 同时承担**第二重价值**：作为今晚 8 PR 修复后 harness 闭环的 canary 验证负载。
端点本身极小（一个路由 + 三字段返回），但整条流水线必须自动跑通：
Planner → GAN 收敛 → Phase B 拆 3-4 子 Task → Generator 正确分支 + rebase main → 4 PR 合并 → Initiative `phase=done`。
人工干预次数 = 0 即为 harness 验收通过。

## 目标

为 Brain 服务提供一个标准的轻量健康端点 `GET /api/brain/health`，返回进程级运行时三元组
`{status, uptime_seconds, version}`，供外部监控、巡检、负载均衡器在不触达数据库的前提下判定 Brain 进程的存活与版本一致性。

## User Stories

- **US-001**（P0）：作为运维/巡检脚本，我希望对 `GET /api/brain/health` 发起请求能在 < 100ms 内拿到 `{status, uptime_seconds, version}` 三元组，以便在不触达数据库的前提下判定 Brain 进程是否健康。
- **US-002**（P0）：作为发布回归者，我希望 `health` 返回的 `version` 字段与 `packages/brain/package.json` 的 `version` 完全一致，以便快速识别灰度/回滚后实际运行的版本。
- **US-003**（P1）：作为内部 selfcheck 任务，我希望进程启动后的累计存活秒数 `uptime_seconds` 是单调递增的非负整数，以便在巡检日报中观察到重启事件。

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 端点存在且 schema 正确）：
- Given Brain 进程已启动且监听 5221
- When 客户端发送 `GET /api/brain/health`
- Then 响应 HTTP 200，Content-Type 为 `application/json`，body 含且仅含三个字段：`status`（字符串）、`uptime_seconds`（数值）、`version`（字符串）

**场景 2**（US-002 — version 与 package.json 一致）：
- Given `packages/brain/package.json` 的 `version` 字段为 `X.Y.Z`
- When 客户端请求 health 端点
- Then 响应 body 的 `version` 字段值严格等于 `X.Y.Z`

**场景 3**（US-001 — status 表征健康）：
- Given Brain 进程刚启动完成监听
- When 客户端请求 health 端点
- Then 响应 body 的 `status` 等于字符串 `"ok"`

**场景 4**（US-003 — uptime 随时间递增）：
- Given Brain 进程在 t0 时刻接收到一次 health 请求得到 `uptime_seconds = u0`
- When 间隔 ≥ 2 秒后在 t1 时刻再次请求 health
- Then 第二次响应的 `uptime_seconds ≥ u0 + 1` 且为非负数

**场景 5**（US-001 — 不依赖 DB）：
- Given 数据库连接池被人为切断（或测试环境未配置 DB）
- When 客户端请求 health 端点
- Then 响应仍返回 HTTP 200 与完整三元组（health 不查询 DB）

## 功能需求

- **FR-001**：在 Brain 服务下新增路由 `GET /api/brain/health`
- **FR-002**：响应 body 必须**只包含**三个字段 `status` / `uptime_seconds` / `version`，无额外字段
- **FR-003**：`status` 字段在进程正常监听时返回 `"ok"`
- **FR-004**：`uptime_seconds` 以进程启动到接收请求时刻的秒数为准，类型为非负数值，向下取整
- **FR-005**：`version` 字段值取自 `packages/brain/package.json` 的 `version` 字段
- **FR-006**：health 端点处理路径**不**执行任何数据库查询、文件 I/O 或外部依赖调用
- **FR-007**：响应 Content-Type 为 `application/json`
- **FR-008**：单测覆盖 status / version / uptime 三字段断言
- **FR-009**：集成测试通过实际启动 server 监听端口、发起 HTTP 请求验证 schema
- **FR-010**：selfcheck/巡检脚本接入 health 作为新的存活信号，并在 docs/current/README.md 巡检表中登记

## 成功标准

- **SC-001**：`curl -s localhost:5221/api/brain/health | jq` 返回严格三字段 JSON，HTTP 状态码 200
- **SC-002**：health 端点 P95 响应时间 < 100ms（本地环境）
- **SC-003**：health 端点单元测试与集成测试在 CI 中通过率 100%
- **SC-004**：harness 闭环：Planner 产出本 PRD 后，Phase B 自动派发 3-4 子 Task，每个 Task 产出独立 PR，全部合并后 Initiative `phase=done`，全程零人工干预

## 假设

- [ASSUMPTION: Brain 当前已有 Express 风格的路由注册机制（基于 `packages/brain/server.js` 的存在），新端点遵循该机制注册]
- [ASSUMPTION: `packages/brain/package.json` 始终有合法 semver 的 `version` 字段]
- [ASSUMPTION: 测试基础设施使用 vitest（因 `packages/brain/vitest.config.js` 存在）]
- [ASSUMPTION: docs/current/README.md 存在且含巡检表小节，用于登记新探针]

## 边界情况

- **进程刚启动 < 1 秒**：`uptime_seconds` 应返回 `0` 而非负数或 NaN
- **package.json 读取异常**：health 仍应返回（`version` fallback 为 `"unknown"`，但不返回 5xx）
- **并发请求**：多个并发 health 请求互不阻塞，每个独立返回 200
- **DB 宕机**：health 路由内不能因 DB 不可用而 5xx
- **进程长时间运行**：`uptime_seconds` 必须能正确表达大于 24 小时的值（不溢出 int32 不是问题，常规 JS Number 即可）

## 范围限定

**在范围内**：
- `GET /api/brain/health` 路由实现与注册
- 三字段 schema 与字段语义
- 单元测试 + 集成测试
- selfcheck/巡检表接入
- 触发 harness 闭环作为 canary 验证

**不在范围内**：
- `/health/db`、`/health/redis` 等子组件健康端点
- Prometheus metrics、OpenTelemetry trace 集成
- 鉴权/限流/CORS 策略调整
- Liveness 与 Readiness 的语义区分（本次只做 liveness 等价物）
- Dashboard UI 上的可视化展示
- 历史 uptime 持久化或图表

## 预期受影响文件

- `packages/brain/server.js`：注册 health 路由 + 进程启动时间常量
- `packages/brain/src/health.js`（新建）：health handler 实现 + version/uptime 计算
- `packages/brain/tests/health.test.js`（新建）：单元测试三字段断言
- `packages/brain/tests/health.integration.test.js`（新建）：启动 server 真实请求集成测试
- `packages/brain/scripts/selfcheck.js`（如存在）或对应巡检脚本：接入 health 探针
- `docs/current/README.md`：巡检表登记新端点
