# Sprint PRD — Brain GET /api/brain/time 端点

## OKR 对齐

- **对应 KR**：Harness v2 闭环可用性（首次端到端验证）
- **当前进度**：四件套 PR #2469 / #2476 / #2479 / #2481 已合并，pipeline 未做过完整真实闭环
- **本次推进预期**：用一个最小功能任务跑通 Planner → GAN → Generator → Task PR merge → Final E2E 全链路

## 背景

Harness v2 的 Planner / GAN / Task Loop / Final E2E 四件套已合入 main，但尚未做过端到端真实任务验证。需要选一个"足够小、纯增量、零回归风险"的功能作为首次链路验收用例。

向 Brain 增加一个只读的当前时间端点，是天然的轻量探针：无副作用、易测、易写文档、易在多 Task 之间切割。

## 目标

让任何调用方（Dashboard / 外部 Agent / 巡检脚本）能通过 `GET /api/brain/time` 获取 Brain 进程当前的标准化时间信息（ISO 字符串、时区、Unix 秒），用作健康探针与时钟对齐。

## User Stories

**US-001**（P0）: 作为运维 / 巡检脚本，我希望调用 `GET /api/brain/time`，以便在不依赖系统时钟的情况下校准 Brain 节点时间。
**US-002**（P0）: 作为前端 / 外部 Agent，我希望从同一接口同时拿到 ISO、时区、Unix 三种格式，以便不同语言客户端都能直接使用。
**US-003**（P1）: 作为 Harness v2 验证负责人，我希望本端点的开发链路完整体现 Planner → GAN → Generator → Final E2E 流程，以便确认 v2 闭环工作。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Brain 进程在 5221 端口运行
- When 调用 `curl localhost:5221/api/brain/time`
- Then 返回 HTTP 200，body 是合法 JSON，包含字段 `iso`、`timezone`、`unix`

**场景 2**（US-002）:
- Given 调用方期望字段类型固定
- When 解析响应
- Then `iso` 是 ISO-8601 字符串（如 `2026-04-21T10:00:00.000Z`），`timezone` 是 IANA 时区字符串（如 `Asia/Shanghai` 或 `UTC`），`unix` 是整数秒（10 位数字）

**场景 3**（US-003）:
- Given 三个字段同源（同一时刻）
- When 客户端比较 `iso` 与 `unix`
- Then `Math.floor(new Date(iso).getTime() / 1000) === unix`（两者一致，允许容差 1 秒）

## 功能需求

- **FR-001**: 暴露 `GET /api/brain/time`，无需鉴权，无副作用
- **FR-002**: 响应体严格为 `{ "iso": string, "timezone": string, "unix": number }`，不含其他字段
- **FR-003**: `iso` 使用 UTC ISO-8601；`unix` 是当前 Unix 秒（整数）；`timezone` 来自 Brain 进程环境或 `Intl.DateTimeFormat().resolvedOptions().timeZone`
- **FR-004**: 路由在 `packages/brain/server.js` 中注册到 `/api/brain/time`
- **FR-005**: CLAUDE.md / docs 中"Brain 知识查询工具"清单新增此端点条目

## 成功标准

- **SC-001**: `curl -s localhost:5221/api/brain/time | jq -e '.iso and .timezone and (.unix | type == "number")'` 返回真值
- **SC-002**: 单元 / 集成测试覆盖 schema、字段类型、`iso` 与 `unix` 一致性，全部通过
- **SC-003**: brain-ci.yml 在引入新文件后保持绿色
- **SC-004**: Harness v2 phase 推进到 `done`，Final E2E 通过

## 假设

- [ASSUMPTION: Brain 当前路由模式遵循 `packages/brain/src/routes/<name>.js` 单文件 Router 导出，再在 `packages/brain/server.js` 内 `app.use('/api/brain/<name>', router)` — 与 infra-status 等同构]
- [ASSUMPTION: 测试位于 `packages/brain/tests/<feature>.test.js`，与 `harness-graph.test.js`、`autonomous-sessions.test.js` 共享同一测试运行器]
- [ASSUMPTION: 时区取 `process.env.TZ`，缺省回退到 `Intl.DateTimeFormat().resolvedOptions().timeZone`，最终 fallback `'UTC'`]

## 边界情况

- Brain 进程未设置 `TZ` 环境变量 → 走 Intl 回退，仍要返回非空字符串
- 高并发同秒多次调用 → 每次返回独立时间戳，不缓存
- 客户端在两次调用之间存在网络延迟 → 各次独立计算，不依赖前次状态

## 范围限定

**在范围内**:
- 新增只读端点 `GET /api/brain/time`
- 路由文件、server 注册、测试、文档同步

**不在范围内**:
- 时间写入 / 设置端点
- 鉴权 / 限流（探针端点不需要）
- 修改现有路由
- 与数据库交互
- 增加监控指标 / 日志（最小实现）

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新增 — Express Router，导出 `GET /` 处理器
- `packages/brain/server.js`：新增一行 `require` 和一行 `app.use('/api/brain/time', timeRoutes)`
- `packages/brain/tests/time.test.js`：新增 — 单元 / 集成测试
- `CLAUDE.md`：在第 7 节"Brain 知识查询工具"中追加 `GET /api/brain/time` 一行说明
