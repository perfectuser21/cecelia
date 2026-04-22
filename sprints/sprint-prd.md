# Sprint PRD — Harness v6 Reviewer Alignment 哲学真机闭环（最小时间端点）

## OKR 对齐

- **对应 KR**：KR-Harness-v6-Alignment（Reviewer/Generator/Evaluator 哲学对齐真机闭环）
- **当前进度**：哲学规范已落地，尚未完成一次端到端真机闭环（Planner → GAN APPROVED → B_task_loop → 子 Task 派 Generator → 合并 → Final E2E → done）
- **本次推进预期**：首次在生产 Brain 上跑通从 Planner 出 DAG 到 Final E2E 的完整链路，并通过产物沉淀真机证据

## 背景

Harness v6 定义了 Reviewer、Generator、Evaluator 三端的哲学对齐规范。规范已上线，但缺少一次**完整真机闭环**来验证：
- Planner 能产出可被 Brain Runner `parseTaskPlan` 消费的 task-plan.json
- GAN 能在 1-3 轮内达成 APPROVED
- Initiative Runner 的 B_task_loop 能依 DAG 顺序派发子 Task
- Generator 产出 PR 并合并
- Final E2E 能在所有子 Task 完成后触发，Initiative 状态翻成 `done`

为降低闭环演示的业务噪声，本 Initiative 选择**最小可观测特性**——新增三个只读时间端点（ISO / timezone / unix），作为被闭环打磨的"靶标"。该靶标本身实现极简（无数据库、无外部依赖、无副作用），使得任何链路失败都可归因到 harness 本身。

## 目标

在 Brain 服务中提供三个最小时间端点（`/api/brain/time/iso`、`/api/brain/time/timezone`、`/api/brain/time/unix`），同时产生一份从 Planner 到 Final E2E 的真机闭环证据。

## User Stories

**US-001**（P0）：作为 Brain 运维者，我希望通过 `GET /api/brain/time/iso` 拿到符合 ISO 8601 的当前时间字符串，以便在脚本中获得一个不依赖本地时钟的稳定参考。

**US-002**（P0）：作为 Brain 运维者，我希望通过 `GET /api/brain/time/timezone` 拿到带时区名与偏移的当前时间对象，以便确认服务运行时区。

**US-003**（P0）：作为 Brain 运维者，我希望通过 `GET /api/brain/time/unix` 拿到 10 位 Unix 秒整数，以便在跨语言场景下简单对时。

**US-004**（P0）：作为 Harness v6 维护者，我希望本 Initiative 的执行过程能留下 sprint-contract.md（GAN APPROVED）、子 Task PR（已合并）、Final E2E 结果（PASS），以作为真机闭环证据。

## 验收场景（Given-When-Then）

**场景 1**（US-001）：
- Given Brain 服务在端口 5221 正常运行
- When 运维者执行 `curl localhost:5221/api/brain/time/iso`
- Then 返回 HTTP 200，body 含字段 `iso`，其值匹配 ISO 8601 格式（含毫秒与 `Z` 或 `±HH:MM` 时区后缀）

**场景 2**（US-002）：
- Given Brain 服务在端口 5221 正常运行
- When 运维者执行 `curl localhost:5221/api/brain/time/timezone`
- Then 返回 HTTP 200，body 含字段 `timezone`（IANA 名字符串，如 `Asia/Shanghai` 或 `UTC`）、`offset`（形如 `+08:00` 或 `+00:00`）、`iso`（当前时刻 ISO 8601）

**场景 3**（US-003）：
- Given Brain 服务在端口 5221 正常运行
- When 运维者执行 `curl localhost:5221/api/brain/time/unix`
- Then 返回 HTTP 200，body 含字段 `unix`，值为 10 位正整数（Unix 秒）

**场景 4**（US-004，闭环证据）：
- Given Initiative 已由 Planner 出 DAG，Brain 已入库
- When 真机流程依次经过：GAN APPROVED → B_task_loop 派子 Task → 全部子 PR 合并 → Final E2E
- Then Initiative 状态在 Brain 中为 `done`，sprints/ 目录存在 sprint-prd.md + sprint-contract.md，所有 3 个端点冒烟通过

## 功能需求

- **FR-001**：Brain 新增 HTTP 路由前缀 `/api/brain/time`，包含 3 个 GET 端点（`/iso`、`/timezone`、`/unix`）
- **FR-002**：所有端点只读、幂等，无鉴权、无请求体、无副作用
- **FR-003**：所有端点返回 JSON（`Content-Type: application/json`），HTTP 200
- **FR-004**：路由实现与现有路由模块共存，不影响既有路由行为
- **FR-005**：本 Initiative 执行过程必须产出可归档的真机证据（见 US-004 场景 4）

## 成功标准

- **SC-001**：3 个端点均返回 200，且 body 字段含义如"验收场景"所述（冒烟全绿）
- **SC-002**：端点响应时间 p95 ≤ 50ms（本地调用）
- **SC-003**：端点实现总新增 LOC ≤ 100（最小靶标约束）
- **SC-004**：GAN 对抗在 1-3 轮内达成 APPROVED
- **SC-005**：Initiative 最终状态 `done`，Final E2E 冒烟 PASS

## 假设

- [ASSUMPTION：Brain 使用 Express Router，与 `packages/brain/src/routes.js` 中既有挂载约定一致（`router.use('/prefix', subRouter)` 或向根 `router.stack` 直接 push）]
- [ASSUMPTION：Node.js 运行时已内置 `Intl.DateTimeFormat` 或等价方式读取 IANA 时区名；若缺失则退化到 `process.env.TZ || 'UTC'`]
- [ASSUMPTION：Brain 进程容器的系统时钟可信，无需额外 NTP 校验]

## 边界情况

- **系统时钟漂移**：端点直接读取 `Date.now()`，不做漂移检测；调用方如有精度需求自行交叉比对 3 个端点
- **时区未配置**：若 `process.env.TZ` 与 `Intl.DateTimeFormat().resolvedOptions().timeZone` 均不可用，fallback 为 `UTC`/`+00:00`，仍返回 200
- **并发调用**：端点无状态，天然并发安全
- **空请求体 / 未知 query 参数**：全部忽略，返回当前时刻

## 范围限定

**在范围内**：
- 3 个时间端点的实现、挂载、冒烟测试
- Harness v6 真机闭环产物（sprint-prd.md、sprint-contract.md、Final E2E 报告）

**不在范围内**：
- 写入端点、时间修改、NTP 同步、鉴权、限流
- 前端展示、Dashboard 集成
- 数据库持久化
- 对 harness 本身代码的修改（本次只是使用 harness 流程）

## 预期受影响文件

- `packages/brain/src/routes/time-endpoints.js`：新文件，实现 3 个时间端点的 Router
- `packages/brain/src/routes.js`：新增一行 import 与一行挂载（如 `router.use('/time', timeEndpointsRouter)`）
- `sprints/sprint-prd.md`：本 PRD（Planner 产物）
- `sprints/sprint-contract.md`：后续 GAN 阶段产出
- `packages/brain/test/time-endpoints.smoke.mjs`（或等效位置）：端到端冒烟脚本（Final E2E 使用）
