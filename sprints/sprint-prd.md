# Sprint PRD — Harness v6 真机闭环测试载体：/api/time 最小端点

## OKR 对齐

- **对应 KR**：Harness v6 Reviewer 哲学迁移验收（spec/产品对齐取代 mutation testing）
- **当前进度**：Reviewer skill 已升级，未做过完整真机闭环
- **本次推进预期**：提供一个最小、真实、可合并的 Initiative 跑通 Planner → GAN → Generator → Merge → Final E2E 全链路

## 背景

Harness v6 Reviewer 把"对抗性挑战测试强度"换成"对齐 spec/产品价值"。哲学改完需要一次真机闭环验收：Planner 出 PRD → GAN 1-3 轮 APPROVED → Runner 拆子 Task → 多 Generator 并行 → 合并 → Final E2E。为避免载体本身成为噪音源，选一个语义明确、纯函数、几乎零依赖的最小端点作为被测产品。

## 目标

在 Brain 上新增一个 `GET /api/time` 端点，返回当前时间的三种表示（iso / timezone / unix），让任何调用方都能以最少参数获得一致的时间戳。该端点同时作为 Harness v6 闭环测试的真实产物。

## User Stories

**US-001**（P0）: 作为 Brain 调用方，我希望访问 `GET /api/time` 能一次拿到当前时间的 ISO-8601 字符串、时区名称、Unix 秒级时间戳，这样我不用在客户端自己处理三种格式。
**US-002**（P1）: 作为时区敏感的调用方，我希望通过 `?tz=Asia/Shanghai` 查询参数指定时区，返回的 iso 字段按该时区偏移量格式化，timezone 字段回显所选时区。
**US-003**（P1）: 作为调用方，当我传入无效时区（如 `?tz=Foo/Bar`）时，我希望收到 400 错误与明确错误消息，而不是被默默 fallback 到服务器默认时区。

## 验收场景（Given-When-Then）

**场景 1**（US-001 默认调用）:
- Given Brain 服务已启动
- When 发起 `GET /api/time`（不带查询参数）
- Then 返回 200，body 为 JSON：`{ iso: string, timezone: string, unix: number }`；`iso` 是合法 ISO-8601 带时区偏移字符串；`unix` 为整数秒；`timezone` 为 IANA 名称（如 `UTC` 或 `Asia/Shanghai`，取决于进程默认）

**场景 2**（US-002 指定时区）:
- Given Brain 服务已启动
- When 发起 `GET /api/time?tz=Asia/Shanghai`
- Then 返回 200；`timezone` 字段等于 `Asia/Shanghai`；`iso` 字段按 `+08:00` 偏移格式化；同一 HTTP 请求内 `iso` 解析回的 Unix 秒数 与 `unix` 字段差值 ≤ 2

**场景 3**（US-003 无效时区）:
- Given Brain 服务已启动
- When 发起 `GET /api/time?tz=Foo/Bar`
- Then 返回 400；body 为 JSON：`{ error: string }`，`error` 内包含子串 `tz` 或 `timezone`

**场景 4**（一致性）:
- Given Brain 服务已启动
- When 两次相邻请求（间隔 < 1 秒）`GET /api/time`
- Then 两次 `unix` 字段差 ≤ 1；两次 `timezone` 字段相等

## 功能需求

- **FR-001**: 注册 `GET /api/time` 路由到 Brain Express 应用（与 `packages/brain/src/routes/` 下其他路由模块风格一致）
- **FR-002**: 默认响应体包含三个字段：`iso`（字符串，ISO-8601 带时区偏移）、`timezone`（字符串，IANA 时区名）、`unix`（整数，Unix 秒级时间戳）
- **FR-003**: 支持可选查询参数 `tz`，值为 IANA 时区名；生效时 `iso` 按该时区偏移格式化，`timezone` 字段回显该值
- **FR-004**: `tz` 为非法 IANA 名称时返回 400 + JSON 错误体，不得静默 fallback
- **FR-005**: 接入 Brain 现有日志/错误处理中间件，不新增独立日志栈

## 成功标准

- **SC-001**: `GET /api/time` 返回的 JSON 能通过 schema 断言（三个字段齐全且类型正确）
- **SC-002**: `GET /api/time?tz=Asia/Shanghai` 与 `GET /api/time?tz=UTC` 返回的 `timezone` 字段不相等且各自匹配查询参数
- **SC-003**: `GET /api/time?tz=Foo/Bar` 返回 HTTP 400
- **SC-004**: 场景 1-4 全部覆盖单元测试或集成测试，CI 绿

## 假设

- [ASSUMPTION: Brain Node 运行时已内置 `Intl.DateTimeFormat` 和 IANA 时区数据库，无需额外依赖]
- [ASSUMPTION: 该端点无需鉴权，与 `/api/brain/context` 等现有公开端点同级]
- [ASSUMPTION: 不需要在 DEFINITION.md 中登记此端点（它是测试载体而非核心 Brain 能力）]

## 边界情况

- `tz` 参数为空字符串 `?tz=` → 视为未传，走默认分支
- `tz` 参数包含 URL 编码字符（如 `Asia%2FShanghai`）→ Express 自动解码后按 IANA 名校验
- 进程默认时区在不同部署环境不同 → 未带 `tz` 时返回的 `timezone` 允许是任意合法 IANA 名
- `unix` 字段必须是整数秒（非毫秒，非浮点）
- 同一次请求内三个字段必须描述"同一瞬间"，`iso` 解析回的时间戳与 `unix` 差值 ≤ 2 秒

## 范围限定

**在范围内**:
- 新路由文件 + 注册到 Brain server
- 默认/指定时区/非法时区三个主要分支
- 单元或集成测试覆盖四个验收场景

**不在范围内**:
- 历史时间查询（仅返回"当前时间"）
- 毫秒/纳秒精度
- 速率限制、鉴权、缓存
- 前端/Dashboard 调用方改造
- 扩展到多端点（本次只交付 `/api/time`）

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新建，端点实现
- `packages/brain/src/server.js`：新增路由注册一行
- `packages/brain/src/__tests__/time.test.js`（或就近测试目录）：新建测试文件
- `packages/brain/package.json`：如确需新增依赖（默认假设不需要）
