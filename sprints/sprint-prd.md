# Sprint PRD — Harness v6 Reviewer Alignment 真机闭环（最小时间端点）

## OKR 对齐

- **对应 KR**：KR-harness-v6-stability（Harness v6 流水线从 Planner 到合并全程无人值守）
- **当前进度**：Reviewer alignment 调整刚落地，尚未经过真机闭环验证
- **本次推进预期**：验证 Planner → GAN(1-3 轮 APPROVED) → B_task_loop → Generator → 合并 → Final E2E 完整链路至少一次跑通

## 背景

Harness v6 最近调整了 Reviewer 的 alignment 哲学（Reviewer 聚焦 spec/产品质量而非单纯测试强度挑战）。调整落地后，整条流水线尚未做过一次"真机闭环"演练。需要一个**功能足够小**、**边界足够清**、**验收足够硬**的载荷（payload）驱动整条流水线走一遍，以暴露 Planner 输出 / GAN 对抗 / B_task_loop 子任务派发 / Generator 生成 / Final E2E 各环节的回归。

选择"最小时间端点"作为载荷原因：
- 不依赖数据库 schema、外部服务、凭据
- 功能边界肉眼可验证（时间格式明确）
- 每个端点可独立测试，天然适合拆成 3-4 个 Task 的 DAG
- 对 Brain 现有逻辑零侵入，合并失败可安全回滚

本 Sprint 的**真实目标不是端点本身**，是让 Harness v6 跑完闭环并可复演。

## 目标

Brain 后端新增一组只读的、零依赖的时间查询端点 `/api/brain/time/*`，三个最小端点（iso / unix / timezone）可用，挂载到 server.js，并通过集成测试。

## User Stories

**US-001**（P0）：作为 Brain API 调用方，我希望 `GET /api/brain/time/iso` 返回当前服务器时间的 ISO-8601 字符串，以便在日志和同步里有一个标准时间源。

**US-002**（P0）：作为 Brain API 调用方，我希望 `GET /api/brain/time/unix` 返回当前服务器时间的 Unix 秒级时间戳（整数），以便做简单的时序比较。

**US-003**（P0）：作为 Brain API 调用方，我希望 `GET /api/brain/time/timezone?tz=<IANA>` 返回给定 IANA 时区下的当前时间字符串，以便跨时区调试。非法时区应返回 400。

**US-004**（P0）：作为 Harness v6 演练观察者，我希望这组端点已经挂到 Brain server.js 的路由表上，并被现有 brain-endpoint-contracts 集成测试覆盖，以便把端点可用性纳入 CI 保护。

## 验收场景（Given-When-Then）

**场景 1**（US-001）：
- Given Brain 已启动
- When 任意客户端发送 `GET /api/brain/time/iso`
- Then 响应码为 200，body 是 JSON，含字段 `iso`，值为一个合法 ISO-8601 字符串（可被 `new Date(...)` 解析回相同时间）

**场景 2**（US-002）：
- Given Brain 已启动
- When 任意客户端发送 `GET /api/brain/time/unix`
- Then 响应码为 200，body 是 JSON，含字段 `unix`，值为正整数，且与 `Math.floor(Date.now()/1000)` 差值在 5 秒以内

**场景 3**（US-003 · happy）：
- Given Brain 已启动
- When 客户端发送 `GET /api/brain/time/timezone?tz=Asia/Shanghai`
- Then 响应码为 200，body 含字段 `tz`（回显 `Asia/Shanghai`）和 `formatted`（非空字符串）

**场景 4**（US-003 · error）：
- Given Brain 已启动
- When 客户端发送 `GET /api/brain/time/timezone?tz=Not/AReal_Zone`
- Then 响应码为 400，body 含 `error` 字段（非空字符串）

**场景 5**（US-003 · missing param）：
- Given Brain 已启动
- When 客户端发送 `GET /api/brain/time/timezone`（无 `tz` 参数）
- Then 响应码为 400，body 含 `error` 字段

**场景 6**（US-004）：
- Given 仓库已合并本 Sprint 所有 Task
- When 运行 brain 集成测试（`brain-endpoint-contracts` 或等价 integration suite）
- Then 三个端点均被覆盖且全部通过

## 功能需求

- **FR-001**：新增路由文件 `packages/brain/src/routes/time.js`，导出默认 Express Router。
- **FR-002**：Router 暴露 `GET /iso`，返回 `{ iso: <ISO-8601 string> }`。
- **FR-003**：Router 暴露 `GET /unix`，返回 `{ unix: <integer seconds> }`。
- **FR-004**：Router 暴露 `GET /timezone`，读取 query 参数 `tz`，非法或缺失返回 HTTP 400 + `{ error: string }`；合法返回 `{ tz, formatted }`。
- **FR-005**：`server.js` 把 Router 挂到 `/api/brain/time`。
- **FR-006**：新端点必须被至少一项集成测试覆盖（真机启动 Brain 或 supertest 挂载 app）。

## 成功标准

- **SC-001**：CI 上所有新增单元测试 + 集成测试 100% 通过。
- **SC-002**：本地 curl 三个端点全部返回预期 shape（PR 描述里应贴出 curl 输出或 test 结果）。
- **SC-003**：本 Sprint 的 4 个 Task 被 Generator 顺序生成为 4 个 PR（或等价单 PR 分 4 个 commit），并按 DAG 顺序合并。
- **SC-004**：Final E2E（Harness v6 `cto_review` / `initiative_verify`）裁决 APPROVED，无需 needs_revision。

## 假设

- [ASSUMPTION: Brain 后端使用 Node.js 内置 `Intl.DateTimeFormat` 即可完成 IANA 时区格式化，无需新增依赖]
- [ASSUMPTION: 现有 brain-endpoint-contracts 集成测试框架可直接挂载新路由做 supertest 测试，不需要改测试基础设施]
- [ASSUMPTION: 端点无需鉴权，定位为 Brain 内部公开只读诊断端点；与 `/api/brain/context`、`/api/brain/status` 同等可见性]

## 边界情况

- 非法 IANA 时区字符串（乱码、SQL 注入样子、空字符串）：400
- 缺失 `tz` query：400
- 并发高频调用：端点必须无副作用、无状态、无数据库 IO（纯 CPU + 时钟）
- `Intl.DateTimeFormat` 在 Node 运行时未加载 ICU 全量数据时的行为：以 `try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch` 捕获 `RangeError` 并归类为 400

## 范围限定

**在范围内**：
- 新增 `packages/brain/src/routes/time.js` 及其单元/集成测试
- 修改 `packages/brain/server.js` 挂载 `/api/brain/time`
- 必要时在现有 brain-endpoint-contracts 测试里注册 3 条合同项

**不在范围内**：
- 不新增 npm 依赖
- 不修改数据库 migration、schema、Brain 核心 tick 逻辑
- 不在前端 dashboard 暴露入口
- 不做缓存/限流/鉴权层
- 不涉及历史时间、时间差、时区转换等扩展能力（仅"当前时间"查询）

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新建 Router，承载三个端点
- `packages/brain/server.js`：新增 import 与 `app.use('/api/brain/time', timeRoutes)`
- `packages/brain/src/__tests__/time-routes.test.js`（或等价位置）：单元测试三个端点
- `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js`（如需扩展）：把 `/api/brain/time/*` 三条加入合同清单
