# Sprint PRD — Harness v6 闭环演练用最小时间端点

## OKR 对齐

- **对应 KR**：Harness v6 哲学真机闭环（Reviewer alignment 验证链路）
- **当前进度**：Planner / GAN / Generator / E2E 链路刚打通，缺少"足够小、无歧义、可端到端跑通"的样本任务
- **本次推进预期**：把闭环从"跑过一次"提升到"能稳定跑过一个完整 Initiative"，作为后续 Harness 真实任务的基线

## 背景

Harness v6 需要一次端到端演练，验证 `Planner → GAN 1-3 轮 APPROVED → B_task_loop → 子 Task 派 Generator → 合并 → Final E2E → done` 完整流程。演练要求 Initiative 的功能面足够小、验收面足够刚性，以便每一轮 GAN 都能聚焦 spec 质量而非实现复杂度。Brain 当前没有任何以 `/api/brain/time/*` 为前缀的时间查询端点，这是一个自然的"最小业务功能"载体。

## 目标

为 Brain 新增一组只读的时间查询端点（ISO 8601 / Unix 时间戳 / 指定时区），让任意调用方通过 HTTP GET 即可拿到服务器当前时间的多种表达，验证 Harness v6 闭环在真实代码改动上的稳定性。

## User Stories

**US-001**（P0）：作为调用 Brain HTTP API 的服务（脚本、前端、外部 agent），我希望通过 `GET /api/brain/time/iso` 拿到当前服务器时间的 ISO 8601 字符串，以便日志/审计字段统一格式。
**US-002**（P0）：作为同上角色，我希望通过 `GET /api/brain/time/unix` 拿到当前服务器时间的 Unix 秒级时间戳，以便和外部 Unix-时间系统对齐。
**US-003**（P0）：作为同上角色，我希望通过 `GET /api/brain/time/timezone?tz={IANA 时区}` 拿到指定时区下当前时间的 ISO 8601 字符串与时区名称，以便跨地域展示。
**US-004**（P1）：作为 Harness 演练发起者（Cecelia），我希望这组端点有充足的集成测试覆盖，以便 Final E2E 能用它作为稳定的闭环演练样本。

## 验收场景（Given-When-Then）

**场景 1**（US-001，正常）：
- Given Brain 已启动且健康
- When 调用方发起 `GET /api/brain/time/iso`
- Then 返回 HTTP 200，body 为 JSON，包含字段 `iso`（ISO 8601 带时区后缀字符串，例如 `2026-04-23T10:00:00.000Z`），且该字符串可被 `new Date(iso)` 成功解析

**场景 2**（US-002，正常）：
- Given Brain 已启动
- When 调用方发起 `GET /api/brain/time/unix`
- Then 返回 HTTP 200，body 包含字段 `unix`（整数秒级时间戳），值在服务器真实当前时间 ±5 秒内

**场景 3**（US-003，合法时区）：
- Given 调用方提供合法 IANA 时区名 `Asia/Shanghai`
- When 调用方发起 `GET /api/brain/time/timezone?tz=Asia/Shanghai`
- Then 返回 HTTP 200，body 包含 `tz: "Asia/Shanghai"` 与 `iso`（该时区下的本地 ISO 8601 字符串，含正确的 `+08:00` 偏移）

**场景 4**（US-003，非法时区）：
- Given 调用方提供非法时区字符串，例如 `Mars/Olympus`
- When 调用方发起 `GET /api/brain/time/timezone?tz=Mars/Olympus`
- Then 返回 HTTP 400，body 包含 `error` 字段说明时区非法；Brain 进程不崩溃

**场景 5**（US-003，缺参）：
- Given 调用方未提供 `tz` query
- When 调用方发起 `GET /api/brain/time/timezone`
- Then 返回 HTTP 400，body 提示缺少 `tz` 参数

**场景 6**（US-004，端到端）：
- Given 三个端点均已实现并挂载
- When 集成测试顺序调用 iso → unix → timezone(Asia/Shanghai) → timezone(非法)
- Then 全部断言通过（状态码、字段结构、错误提示）

## 功能需求

- **FR-001**：新增路由模块，集中维护时间查询端点，挂载前缀为 `/api/brain/time`
- **FR-002**：`GET /api/brain/time/iso` 返回 `{ iso: string }`，`iso` 为当前服务器时间的 ISO 8601 UTC 字符串
- **FR-003**：`GET /api/brain/time/unix` 返回 `{ unix: number }`，`unix` 为整数秒级时间戳
- **FR-004**：`GET /api/brain/time/timezone?tz={IANA}` 合法输入返回 `{ tz: string, iso: string }`，`iso` 为带正确偏移量的该时区 ISO 8601 字符串
- **FR-005**：`timezone` 端点对非法 / 缺失 `tz` 参数返回 HTTP 400 + `error` 字段，不抛未处理异常
- **FR-006**：三端点全部 HTTP GET，无需鉴权（与现有 Brain 只读端点一致）
- **FR-007**：集成测试覆盖 6 个验收场景

## 成功标准

- **SC-001**：`curl -s localhost:5221/api/brain/time/iso` 返回 HTTP 200 且 body 里 `iso` 可被 `Date.parse` 解析为非 NaN
- **SC-002**：`curl -s localhost:5221/api/brain/time/unix` 返回 HTTP 200 且 `unix` 与 `Math.floor(Date.now()/1000)` 误差 ≤ 5
- **SC-003**：`curl -s 'localhost:5221/api/brain/time/timezone?tz=Asia/Shanghai'` 返回 HTTP 200 且 `iso` 字符串以 `+08:00` 结尾
- **SC-004**：`curl -s -o /dev/null -w '%{http_code}' 'localhost:5221/api/brain/time/timezone?tz=Mars/Olympus'` 输出 `400`
- **SC-005**：`curl -s -o /dev/null -w '%{http_code}' 'localhost:5221/api/brain/time/timezone'` 输出 `400`
- **SC-006**：覆盖上述 6 场景的集成测试在 `npm test` 或等价命令下全部通过

## 假设

- [ASSUMPTION: Brain 运行环境（Node.js）原生 `Intl.DateTimeFormat` 能识别常见 IANA 时区，无需额外引入 tz 数据包]
- [ASSUMPTION: 以 `/api/brain/*` 作为挂载前缀与 Brain 其他路由保持一致，前端/外部调用遵循该约定]
- [ASSUMPTION: 这组端点作为 Harness 演练样本，不会承担生产流量压力，因此无需加缓存、限流]

## 边界情况

- **空 query**：`timezone` 端点 `tz` 缺失 → 400
- **非法时区字符串**（包含乱码、不存在、大小写不符）→ 400，不抛异常
- **闰秒 / DST 切换**：返回以 Date 对象为准，不做人工补偿
- **并发**：三端点无状态，无共享变量，并发安全
- **请求头缺失**：GET 无需任何自定义 header

## 范围限定

**在范围内**：
- 新增 `packages/brain/src/routes/time.js`（或等价位置）
- 在 `packages/brain/server.js` 挂载 `/api/brain/time`
- 实现 `/iso` / `/unix` / `/timezone` 三个只读端点
- 新增集成测试覆盖 6 场景

**不在范围内**：
- 任何写操作端点（POST/PATCH/DELETE）
- 鉴权 / 限流 / 缓存
- 前端 UI 变更
- DB schema 变更
- OKR/Task 关联的业务逻辑
- 任何与"时间"无关的 Brain 路由重构

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新建；承载三端点的路由处理函数
- `packages/brain/server.js`：新增一行 `app.use('/api/brain/time', timeRoutes)` 挂载
- `packages/brain/src/__tests__/time-routes.test.js`：新建；集成测试覆盖 6 场景
