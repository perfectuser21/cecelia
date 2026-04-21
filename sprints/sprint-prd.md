# Sprint PRD — Brain /api/brain/time 端点

## OKR 对齐

- **对应 KR**：KR-Harness-v2（Harness v2 pipeline 闭环验证）
- **当前进度**：四件套（#2469/#2476/#2479/#2481）已合并，未跑通整链路
- **本次推进预期**：首次 Planner→GAN→Task Loop→E2E 全绿闭环

## 背景

Harness v2 pipeline 的核心四件套已合并入 main，需要一个轻量、无副作用的端到端验收任务，驱动完整链路：Planner 拆 Task → GAN 合同对抗 → B_task_loop 自动派发 → 子 Task PR 自动合并 → Final E2E → phase=done。

选择给 Brain 新增一个只读、幂等、零依赖的时间端点 `GET /api/brain/time` 作为验收载体：实现简单、不触发数据库迁移、不扰动现有业务，能稳定地让 pipeline 每个 Gate 都被真实路径走过一遍。

## 目标

外部调用方（包括 Dashboard 前端、容器内 agent、运维脚本）能通过 `GET /api/brain/time` 一次拿到 Brain 服务的权威当前时间，用于时钟校验、时区诊断和跨服务时间戳对齐。

## User Stories

**US-001**（P0）: 作为调用方，我希望向 Brain 发送一次 HTTP GET 请求就能获取当前时间，以便在客户端不依赖本地时钟的情况下校准时间戳。

**US-002**（P0）: 作为运维/诊断人员，我希望返回体同时包含 ISO 字符串、IANA 时区名、Unix 秒数三种表达，以便一眼核对时钟、时区和时间戳是否一致。

**US-003**（P1）: 作为新端点的使用方，我希望在 Brain 公开文档中能直接查到这个端点的存在、响应结构和示例，不必通过阅读源码发现。

## 验收场景（Given-When-Then）

**场景 1**（US-001 / US-002 happy path）:
- Given Brain 服务正常运行在 5221 端口
- When 调用方发起 `GET /api/brain/time`
- Then 响应 HTTP 200，Content-Type 为 `application/json`，响应体包含三个字段 `iso`、`timezone`、`unix`，三者表达的是同一个时刻

**场景 2**（字段形状合规）:
- Given 已收到 /api/brain/time 的成功响应
- When 校验字段类型
- Then `iso` 是符合 ISO 8601 扩展格式的字符串；`timezone` 是非空字符串（IANA 时区名）；`unix` 是正整数（秒，不是毫秒）

**场景 3**（端点可发现）:
- Given 一个新的开发者打开 Brain API 文档
- When 浏览 API 列表
- Then 能找到 `/api/brain/time` 条目，包含方法、路径、响应示例

## 功能需求

- **FR-001**: Brain 新增只读路由 `GET /api/brain/time`，无需鉴权，无副作用
- **FR-002**: 响应体固定包含三个字段：`iso`（字符串）、`timezone`（字符串）、`unix`（数字）
- **FR-003**: 三个字段在同一次调用内指向同一时刻（同一个 `Date` 快照），不允许跨字段漂移
- **FR-004**: 端点在 Brain 主服务入口被正确挂载，启动后即可访问
- **FR-005**: 有自动化测试覆盖端点：成功响应、字段存在、字段类型、三字段同时刻一致性
- **FR-006**: Brain 公开 API 文档新增该端点条目

## 成功标准

- **SC-001**: 自动化测试套件中存在一个专门覆盖 /api/brain/time 的 test 文件，`npm test` 在 Brain 工作区通过
- **SC-002**: 直接 `curl http://localhost:5221/api/brain/time` 返回 200 且响应体同时包含 `iso`、`timezone`、`unix` 三个非空字段
- **SC-003**: `docs/current/README.md`（或等价 API 目录）包含对 /api/brain/time 的说明与示例
- **SC-004**: 端点对同一瞬间的多次连续调用，返回的 `iso` 与 `unix` 可以相差毫秒级，但三字段组合在每次调用内部自洽

## 假设

- [ASSUMPTION: Brain 已经使用 Express + ESM + vitest 的既有路由/测试约定，新增端点只需沿用同目录同风格]
- [ASSUMPTION: 服务进程的系统时区配置是权威来源，返回的 `timezone` 就是 Node 进程的当前 IANA 时区]
- [ASSUMPTION: 不需要为该端点加 rate limit、缓存、鉴权，Brain 网关层和既有中间件已足够]

## 边界情况

- 进程时区为 UTC 时：`timezone` 应为 `"UTC"` 或等价 IANA 名，不能返回空字符串
- 响应里 `unix` 必须是秒级整数，不允许是毫秒或浮点
- 连续两次调用：允许时间推进，但同一次调用内 `iso` / `unix` 必须互相一致（不能出现 iso 是 12:00:00 而 unix 指向 12:00:05）

## 范围限定

**在范围内**:
- 新增一个只读 GET 路由及其测试
- 把路由挂载到 Brain 主服务
- 在公开 API 文档新增条目

**不在范围内**:
- 不做鉴权/限流/审计埋点
- 不引入新的依赖包
- 不做时区切换、时间代理、时钟同步（NTP）等更重能力
- 不改 Dashboard / 前端调用方代码
- 不写数据库迁移

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新增路由实现
- `packages/brain/server.js`：挂载新路由到主服务
- `packages/brain/src/__tests__/routes-time.test.js`：端点自动化测试
- `docs/current/README.md`：新增 /api/brain/time 条目
