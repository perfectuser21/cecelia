# Sprint PRD — Brain /api/brain/health 最小健康端点（harness v2 闭环验证）

## OKR 对齐

- **对应 KR**：harness v2 自动化闭环（Planner → GAN → Phase B → Generator → 4 PR 合并 → Initiative phase=done）的零人工保姆验收
- **当前进度**：今晚 8 PR 修复刚落地，闭环尚未端到端跑过一次
- **本次推进预期**：完成首次 zero-human-babysit 全自动闭环，证明 v2 harness 可在单个真实 Initiative 上稳定收敛

## 背景

今晚 8 个 PR 修复了 harness v2 闭环中的若干关键缺口（Planner/GAN/Phase B 派发/Generator 分支策略/rebase 流程）。需要一个**功能面极小、但能真实触达 Brain 代码路径**的 Initiative 来做端到端验证。极小端点 `GET /api/brain/health` 恰好满足：
- 功能原语极简（只读、无副作用、无数据库），避免把闭环失败归因到业务复杂度
- 真实改动 Brain 运行代码（不是 docs-only），能触发 brain-ci.yml
- 可被独立 smoke 验证（curl 一次就能判定），便于后续 Evaluator 机械复核

**关联决策**：本任务不与任何现有决策冲突；与 `/api/brain/status` 并列为轻量探活端点，但定位不同（status 是决策包，health 是纯运维探活）。

## 目标

对外暴露 `GET /api/brain/health`，返回 `{status, uptime_seconds, version}` 三字段，作为 Brain 进程级探活入口，并以此为载体让 harness v2 在真实改动上完成一次零人工全自动闭环。

## User Stories

- **US-001**（P0）: 作为运维 / 探活脚本，我希望 `curl localhost:5221/api/brain/health` 立即返回 HTTP 200 + `{status, uptime_seconds, version}`，以便在无数据库连接、无鉴权的前提下判断 Brain 进程是否存活
- **US-002**（P0）: 作为 harness v2 Evaluator，我希望该端点的行为能通过一条确定的 curl 命令机械复核，以便 Initiative phase=done 的裁决来自可执行验证而非人工目测
- **US-003**（P1）: 作为后续监控系统集成方，我希望 `version` 字段反映 Brain 当前运行的 package 版本，以便部署回滚时能从端点直接读到版本号

## 验收场景（Given-When-Then）

**场景 1**（US-001 · happy path）:
- Given Brain 服务已启动并监听 5221 端口
- When 发起 `curl -s localhost:5221/api/brain/health`
- Then HTTP 200，响应 JSON 含且仅含 `status`、`uptime_seconds`、`version` 三键；`status === "ok"`；`uptime_seconds` 为非负数；`version` 为非空字符串

**场景 2**（US-001 · 字段语义）:
- Given Brain 刚启动几秒
- When 连续两次请求 `/api/brain/health`，间隔 ≥1 秒
- Then 第二次返回的 `uptime_seconds` 严格大于第一次

**场景 3**（US-002 · 数据库无关性）:
- Given Brain 进程在运行，但数据库临时不可达
- When 请求 `/api/brain/health`
- Then 仍然返回 HTTP 200 + 三字段（该端点不得依赖 pg pool）

**场景 4**（US-003 · 版本字段）:
- Given Brain 以 `packages/brain/package.json` 中记载的版本号启动
- When 请求 `/api/brain/health`
- Then 返回体 `version` 等于该 package.json 的 `version` 字段值

**场景 5**（边界 · 错误方法）:
- Given 路由已挂载
- When 以 POST 方法请求 `/api/brain/health`
- Then 返回 HTTP 404 或 405（不得返回 200 或 5xx 崩溃）

## 功能需求

- **FR-001**: 新增路由模块暴露 `GET /`，返回 `{status: "ok", uptime_seconds: <number>, version: <string>}`
- **FR-002**: 路由模块被 `packages/brain/server.js` 挂载到 `/api/brain/health` 路径
- **FR-003**: 端点实现不得查询数据库、不得请求外部服务、不得依赖 tick 状态
- **FR-004**: `uptime_seconds` 来自进程启动以来的运行秒数
- **FR-005**: `version` 来自 `packages/brain/package.json` 的 `version` 字段
- **FR-006**: 提供单元测试覆盖路由模块的字段契约
- **FR-007**: 提供集成/smoke 测试：启动服务后 curl 端点能拿到三字段 200 响应

## 成功标准

- **SC-001**: `curl -sf localhost:5221/api/brain/health | jq '.status, .uptime_seconds, .version'` 三行全部非空且非 null
- **SC-002**: 单元测试套件中新增针对 health 路由的测试全部通过
- **SC-003**: 集成测试中新增针对 `/api/brain/health` 的 smoke 用例通过
- **SC-004**: brain-ci.yml 在 4 个 PR 全部合并后仍然绿灯
- **SC-005**: harness v2 Runner 自动将 Initiative phase 置为 `done`，无需人工干预

## 假设

- [ASSUMPTION: Brain 进程以 `node server.js` 启动，`process.uptime()` 可直接作为 `uptime_seconds` 的来源]
- [ASSUMPTION: `packages/brain/package.json` 的 `version` 字段是本端点对外 `version` 的唯一事实来源（与 `VERSION` 文件保持同步由既有 DevGate `check-version-sync.sh` 保证，本 Initiative 不负责）]
- [ASSUMPTION: 本次 Initiative 不引入鉴权；`/api/brain/health` 为无鉴权公开端点，与 `/api/brain/status` 的现行暴露姿态一致]
- [ASSUMPTION: harness v2 Phase B 能根据 task-plan.json 的 `depends_on` 自动并行派单到可执行 Task]

## 边界情况

- **DB 不可用**：端点返回 200（不依赖 DB）
- **异常方法**：POST/PUT/DELETE 到 `/api/brain/health` 返回 404/405，不得 500
- **并发请求**：每秒多次请求不引起进程状态漂移（纯只读）
- **启动极早期**：启动 <1s 时请求应正常返回，`uptime_seconds` 可能为 0 或小数

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/health` 路由模块与挂载
- 路由模块的单元测试
- 针对该端点的 smoke/集成测试
- 字段契约 `{status, uptime_seconds, version}`

**不在范围内**:
- 鉴权 / rate limit
- 依赖检查（DB / N8N / external services 的健康）
- `/api/brain/status`、`/api/brain/context` 等既有端点的改动
- 前端 Dashboard 消费该端点
- 告警/监控系统对该端点的订阅接入
- 版本号同步机制的任何改造（`VERSION` ↔ `package.json`）

## 预期受影响文件

- `packages/brain/src/routes/health.js`: 新增路由模块，定义 `GET /` handler
- `packages/brain/server.js`: 新增 `app.use('/api/brain/health', healthRoutes)` 挂载行
- `packages/brain/src/__tests__/routes/health.test.js`: 新增单元测试
- `packages/brain/src/__tests__/integration/health.integration.test.js`: 新增集成 smoke 测试
