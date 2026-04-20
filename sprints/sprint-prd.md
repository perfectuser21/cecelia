# Sprint PRD — Brain /api/brain/time 端点（Harness v2 闭环验证）

## OKR 对齐

- **对应 KR**：Harness v2 自动化开发流水线可用性
- **当前进度**：四件套（#2469 / #2476 / #2479 / #2481）已合并，尚未首次端到端验证
- **本次推进预期**：首次跑通 Planner → GAN 合同对抗 → B_task_loop 多 Task 派发 → Task PR 自动 merge → runPhaseCIfReady → Final E2E → phase=done 的完整链路

## 背景

Harness v2 四件套合并后尚未有一次完整端到端的闭环运行。需要一个足够小、行为可观察、验证面充分的真实开发任务作为烟囱测试（smoke run），确保以下环节都被触发至少一次：

1. Planner 拆分可调度 Task DAG
2. GAN 合同对抗（1-3 轮直至 Reviewer APPROVED）
3. B_task_loop 按拓扑序派发子 Task 给容器
4. 每个 Task 的 PR 被 Harness 自动 merge
5. 所有 Task completed 后 `runPhaseCIfReady` 触发 Final E2E
6. Initiative phase 推进至 `done`

"给 Brain 加一个 `GET /api/brain/time` 端点，返回 `{iso, timezone, unix}`"是理想载体：实现成本低、边界清晰、验证点可行为化（HTTP 返回结构、字段类型、时区正确性），且对路由注册 / 测试 / 文档三类工程资产都有触达。

## 目标

给 Brain HTTP 服务新增一个只读的时间端点 `GET /api/brain/time`，任意调用方调用可得到一个结构稳定的 JSON 响应，用以同步或校对客户端时钟，并作为 Harness v2 首次端到端闭环的验证载荷。

## User Stories

**US-001**（P0）: 作为 Brain 的任意 HTTP 消费者（Dashboard / Agent / Ops 脚本），我希望调用 `GET /api/brain/time` 得到 `{iso, timezone, unix}` 三字段 JSON，以便同步或校对本地时钟。

**US-002**（P0）: 作为 Harness v2 的运维者，我希望本次 Initiative 走完 Planner → GAN → Task DAG → Auto-merge → Final E2E → phase=done 全链路，以便确认四件套合并后流水线可用。

**US-003**（P1）: 作为维护者，我希望文档里写明 `GET /api/brain/time` 的契约（路径 / 方法 / 响应字段 / 含义），以便后续调用方无需读源码即可集成。

## 验收场景（Given-When-Then）

**场景 1**（US-001 主路径）:
- Given Brain HTTP 服务处于运行状态
- When 任意客户端发起 `GET /api/brain/time`
- Then 响应状态码 `200`，`Content-Type` 为 `application/json`，响应体包含三个字段 `iso`（ISO-8601 字符串）、`timezone`（IANA 时区名或等价标识）、`unix`（整数秒级 Unix 时间戳）

**场景 2**（US-001 字段一致性）:
- Given 服务时间为某一瞬间 T
- When 客户端发起 `GET /api/brain/time`
- Then `iso` 对应的瞬时时间与 `unix`（秒级）之差应在 ±2 秒以内（避免请求内部处理造成的 drift）

**场景 3**（US-002 Harness 链路）:
- Given Harness v2 Runner 拾起本 Initiative 的 PRD 与 task-plan.json
- When Runner 走完 A（Planner）→ GAN 合同对抗 → B_task_loop → 每 Task PR 自动 merge → C（Final E2E）阶段
- Then Initiative `phase` 字段最终为 `done`，且每个 Task `status` 为 `completed`

**场景 4**（US-003 文档就位）:
- Given 合并后的仓库
- When 读者打开 Brain API 文档入口（README 或等效聚合文档）
- Then 能看到 `GET /api/brain/time` 的路径 / 方法 / 响应字段 三项契约信息

## 功能需求

- **FR-001**: 新增 HTTP 路由 `GET /api/brain/time`，未鉴权前提下对所有调用方返回相同结构
- **FR-002**: 响应体字段固定为 `iso` / `timezone` / `unix` 三个键，无多余字段
- **FR-003**: `iso` 使用 ISO-8601 格式，`timezone` 使用 IANA 时区名（例 `Asia/Shanghai`）或 `UTC`，`unix` 为整数秒
- **FR-004**: 响应的 `Content-Type` 为 `application/json`
- **FR-005**: 端点在 Brain HTTP 服务启动时自动注册，无需额外配置
- **FR-006**: 存在一份可机读的响应契约描述（JSON Schema 片段或等价结构化注释），供测试与文档共用
- **FR-007**: 文档中出现对该端点的介绍，至少包含路径 / 方法 / 响应字段 / 含义

## 成功标准

- **SC-001**: 一个对 `GET /api/brain/time` 的 HTTP 行为测试通过（断言 200 / 三字段存在 / 字段类型正确）
- **SC-002**: 一个对 iso 与 unix 一致性的行为测试通过（差值 ≤ 2 秒）
- **SC-003**: Initiative 最终 `phase=done` 且所有 Task `status=completed`
- **SC-004**: 文档中存在端点描述（可通过文件内搜索关键字 `/api/brain/time` 命中）

## 假设

- [ASSUMPTION: Brain HTTP 服务使用 Express，已有 `packages/brain/src/routes/` 模块化路由目录，新增路由遵循 `app.use('/api/brain/...')` 注册模式]
- [ASSUMPTION: Brain 现有测试体系可直接承载新增路由的行为测试（无需新建测试框架）]
- [ASSUMPTION: 服务运行环境的时区为 `Asia/Shanghai` 或 `UTC`，`timezone` 字段取 `process.env.TZ` / `Intl.DateTimeFormat().resolvedOptions().timeZone` / `UTC` 其中之一，具体由实现自决]

## 边界情况

- 客户端请求非 GET 方法（如 POST）：行为不作强约束，交由 Express 默认处理
- 服务时区未设置：仍须返回一个非空 `timezone`（退化为 `UTC` 可接受）
- 并发请求：端点必须保持无副作用、无状态
- 时间源异常（极端情况下系统时钟跳变）：端点不负责修正，直接反映当前系统时间

## 范围限定

**在范围内**:
- 新增只读 GET 端点与响应契约
- 一份行为测试覆盖字段结构与一致性
- 文档补充端点契约描述
- 端点在 Brain 启动时自动生效

**不在范围内**:
- 身份认证 / 授权 / 限流
- 时间设置 / 写端点 / NTP 同步
- Dashboard 前端消费该端点的 UI 改动
- OpenAPI 全量导出或 SDK 代码生成

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新增路由模块，导出 Express Router
- `packages/brain/server.js`：注册新路由（`app.use('/api/brain/time', ...)` 或等效）
- `packages/brain/src/__tests__/routes-time.test.js`：行为测试（状态码 / 字段 / 一致性）
- `docs/current/README.md` 或 Brain API 说明入口文档：补充端点条目
- `packages/brain/src/contracts/time-response.schema.json`（或等效轻量契约片段）：响应结构契约，供测试与文档引用
