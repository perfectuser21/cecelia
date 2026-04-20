# Sprint PRD — Brain 新增 GET /api/brain/time 端点

**Task ID**: 421c8aaa-112b-4aee-8aef-0b4ea4ee3d79
**Sprint Dir**: sprints
**生成时间**: 2026-04-20

## OKR 对齐

- **对应 KR**：[ASSUMPTION: Brain API 基础能力完善 / Harness v2 闭环验证方向的 KR]
- **当前进度**：[ASSUMPTION: `curl localhost:5221/api/brain/context` 在当前执行环境内不可达；Step 0 上下文采集失败]
- **本次推进预期**：[ASSUMPTION: 本 Initiative 并非新增业务能力，而是 Harness v2 四件套（#2469/#2476/#2479/#2481）合并后的首次端到端闭环验证；预期推进 Harness v2 GA KR 5-10%]
- **说明**：真正的交付价值在于走通 Planner → GAN 对抗 → B_task_loop → 子 PR 合并 → runPhaseCIfReady → Final E2E → phase=done 的完整链路。时间端点只是验证载体，保持最小实现。

## 背景

Harness v2 已合并 #2469/#2476/#2479/#2481 四件套，需要首次真实 Initiative 流水验证：Planner 拆 Task DAG → Proposer/Reviewer 合同对抗 → 自动晋级 task loop → 容器派 Generator 执行子 Task → 子 PR 自动 merge → 收敛 Final E2E → phase=done。

选用"新增 GET /api/brain/time 端点"作为验证载体，理由：
- 范围小，单 Task < 60min
- 无外部依赖（不需要 DB 变更、不需要新包）
- 响应结构固定 `{iso, timezone, unix}`，便于 DoD 的 [BEHAVIOR] 测试编写
- 与 Brain 现有 routes 目录结构高度对齐（`packages/brain/src/routes/`），新增一个 route 文件即可

## 目标

让调用方通过 `GET /api/brain/time` 获取 Brain 进程的当前时间信息，一次返回 ISO 8601 字符串、时区标识、Unix 时间戳三个字段。

## User Stories

**US-001**（P0）：作为 **Harness 流水调用方**，我希望 `GET /api/brain/time` 返回当前时间的 ISO / 时区 / Unix 三元组，以便在 agent 侧做时间对齐和日志标注。

**US-002**（P0）：作为 **运维/巡检脚本**，我希望该端点稳定可用（200 OK + 固定 JSON schema），以便作为 Brain 存活探针和时钟偏移探测点使用。

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 成功返回时间三元组）：
- Given Brain 进程已启动并监听 5221 端口
- When 调用 `GET http://localhost:5221/api/brain/time`
- Then 响应 HTTP 200，Content-Type `application/json`
- And 响应 body 为 JSON 对象，包含恰好三个顶层字段 `iso`、`timezone`、`unix`
- And `iso` 为合法 ISO 8601 字符串（可被 `new Date(iso)` 解析且 `!isNaN`）
- And `timezone` 为非空字符串（IANA 时区标识，例如 `Asia/Shanghai` 或 `UTC`）
- And `unix` 为正整数（秒级 Unix 时间戳）

**场景 2**（US-002 — 时间值一致性）：
- Given 在同一次响应里
- When 解析 `iso` 得到 Date 对象 D
- Then `Math.floor(D.getTime()/1000) === unix` 成立（允许 ±1 秒漂移）

**场景 3**（US-002 — 幂等可重复调用）：
- Given 连续两次调用该端点
- When 两次响应均为 200
- Then 两次响应的 `timezone` 字段一致
- And 两次 `unix` 的差值 ≥ 0（单调不减）

## 功能需求

- **FR-001**: 在 Brain 注册新路由 `GET /api/brain/time`
- **FR-002**: 响应 body 为 JSON，包含 `iso`（ISO 8601）、`timezone`（IANA 字符串）、`unix`（整数秒）三个字段，且仅此三个顶层字段
- **FR-003**: 该端点无需鉴权、无 query/body 参数、幂等可重复调用
- **FR-004**: 该端点的实现必须具备单元测试覆盖，断言上述三字段 shape 与一致性
- **FR-005**: 该端点在系统文档（`docs/current/` 或 Brain README route 列表）中有对应记录

## 成功标准

- **SC-001**: `curl localhost:5221/api/brain/time` 返回 HTTP 200 且响应可被 `JSON.parse` 成功解析
- **SC-002**: 响应对象三字段类型与场景 1 的断言全部通过
- **SC-003**: 单元测试在 Brain CI 中 PASS
- **SC-004**: Harness v2 Initiative 从 Planner → Final E2E → phase=done 全链路无人工介入完成

## 假设

- [ASSUMPTION: Brain 路由文件位于 `packages/brain/src/routes/*.js`，采用 `import { Router } from 'express'` + `router.get(...)` + `export default router` 的模式，与 `status.js` 一致]
- [ASSUMPTION: 主入口在 `packages/brain/server.js`，以 `import xxxRoutes from './src/routes/xxx.js'` 的形式注册子路由]
- [ASSUMPTION: Brain 默认时区读取 `process.env.TZ`，若未设置则 fallback 到 `Intl.DateTimeFormat().resolvedOptions().timeZone`]
- [ASSUMPTION: 单元测试与既有 `packages/brain/src/__tests__/` 保持相同技术栈（node --test 或 jest，由 Generator 按 repo 现状选择）]

## 边界情况

- **时区未配置**：`process.env.TZ` 不存在时，`timezone` 字段仍必须为非空字符串（通过 Intl API 兜底，不得返回空串或 null）
- **闰秒/时钟跳变**：同一次响应内 `iso` 与 `unix` 允许 ≤ 1 秒偏差（见场景 2）
- **并发**：端点无状态，不需要并发控制；多请求串行/并行返回结果互不影响

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/time` 路由（handler + 注册 + 单元测试）
- 文档更新（SYSTEM_MAP 路由表 / Brain README 或同级位置）

**不在范围内**:
- 授权/鉴权中间件
- 缓存或限流
- 时区切换、用户级时区偏好
- 前端消费方改造
- 任何与 `/time` 无关的 Brain 路由重构

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新增 — route handler 实现
- `packages/brain/server.js`：新增一行 import + 一行 `app.use('/api/brain', timeRoutes)` 或等价注册
- `packages/brain/src/__tests__/time.test.js`：新增 — 单元测试
- `docs/current/SYSTEM_MAP.md` 或 `packages/brain/README.md`：新增 — 在 Brain API 路由列表追加一行 `/api/brain/time`
