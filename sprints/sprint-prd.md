# Sprint PRD — Brain 新增 GET /api/brain/time 时间端点

**Task ID**: 421c8aaa-112b-4aee-8aef-0b4ea4ee3d79
**Initiative ID**: 421c8aaa-112b-4aee-8aef-0b4ea4ee3d79
**Sprint Dir**: sprints
**生成时间**: 2026-04-20

## OKR 对齐

- **对应 KR**：[ASSUMPTION: Brain API 不可达（`curl localhost:5221/api/brain/context` 返回 exit 7），无法确认具体 KR 编号；推断对应"Harness v2 闭环验证 / Brain 可观测性"方向的 KR]
- **当前进度**：[ASSUMPTION: 未知]
- **本次推进预期**：[ASSUMPTION: 作为 Harness v2 四件套合并后首次端到端验收，本 Initiative 通过后该方向 KR 预期推进 5-10%]

## 背景

Harness v2 四件套（#2469 / #2476 / #2479 / #2481）已合并入 main。本 Initiative 是四件套合并后的首次闭环验证：给 Brain 增加一个最简单的只读 GET 端点，用来走通 Planner → GAN 合同对抗 → B_task_loop 容器派工 → 子 Task PR 自动合并 → runPhaseCIfReady → Final E2E → phase=done 的完整链路。

端点本身功能极小，目的是让链路各环节有真实代码产物可验证，而不是测试 Brain 的新业务能力。

## 目标

让调用方通过 `GET /api/brain/time` 拿到 Brain 服务端当前时间的三元组：ISO 8601 字符串、时区名、Unix 秒级时间戳。

## User Stories

**US-001**（P0）: 作为 Brain API 的调用方，我希望通过 `GET /api/brain/time` 获取 Brain 服务端的当前时间（含 ISO、时区、Unix 三种表示），以便在调试、日志对齐、分布式一致性检查时无需解析其他端点响应就能拿到时间基准。

**US-002**（P1）: 作为 Harness v2 流水线的维护者，我希望这个端点作为最小可验证产物，走通四件套合并后的完整闭环（Planner → GAN → B_task_loop → PR merge → Final E2E → phase=done），以便验证新管线健康度。

## 验收场景（Given-When-Then）

**场景 1**（US-001 正常返回）:
- Given Brain 服务已在端口 5221 启动
- When 调用方发起 `GET http://localhost:5221/api/brain/time`
- Then 响应 HTTP 200，Content-Type 为 `application/json`，body 为 `{ "iso": "<ISO 8601 字符串>", "timezone": "<IANA 时区名>", "unix": <整数秒> }` 三字段齐全

**场景 2**（US-001 字段语义）:
- Given 端点已返回 payload
- When 调用方比对三个字段
- Then `iso` 是合法 ISO 8601（可被 `new Date(iso)` 解析），`unix` 等于 `Math.floor(new Date(iso).getTime()/1000)`（容差 1 秒），`timezone` 是非空字符串

**场景 3**（US-002 闭环）:
- Given 本 Initiative 的所有 Task 进入 Brain DAG 调度
- When GAN 合同审核通过 + 每个 Task 的 PR 自动 merge + runPhaseCIfReady 触发 Final E2E
- Then Initiative 的 `phase` 字段最终变为 `done`

## 功能需求

- **FR-001**: Brain 暴露 `GET /api/brain/time` 路由，返回 JSON
- **FR-002**: 响应体三字段 `iso` / `timezone` / `unix`，键名严格小写且完全匹配
- **FR-003**: 端点为只读、幂等、无副作用，无需鉴权参数（与 Brain 现有只读 context 端点一致）
- **FR-004**: 端点在 Brain 现有路由体系内挂载（与其他 `/api/brain/*` 路由同级）

## 成功标准

- **SC-001**: 端点返回 HTTP 200 + JSON 三字段（可由契约测试验证）
- **SC-002**: 单元测试 / 集成测试用例覆盖正常路径，且在 `npm test` 本地与 brain-ci.yml 均通过
- **SC-003**: 系统文档（`docs/current/SYSTEM_MAP.md` 或等价文件）登记该端点，使其在 Brain 路由清单中可检索
- **SC-004**: 本 Initiative 对应的 4 条 Task 全部 completed 后，Initiative phase=done

## 假设

- [ASSUMPTION: Brain 路由在 `packages/brain/src/routes/*.js` 下以独立模块方式组织，新端点遵循该约定新增 `routes/time.js`]
- [ASSUMPTION: Brain 现有 `__tests__` 目录位于 `packages/brain/src/__tests__/`，新测试就地新增 `time.test.js`]
- [ASSUMPTION: 时区字段取自 Node 进程 `Intl.DateTimeFormat().resolvedOptions().timeZone`，无需引入第三方时区库]
- [ASSUMPTION: 端点不需要设置缓存头；每次请求返回当前时间即可]
- [ASSUMPTION: 文档更新只需登记端点存在性 + URL + 响应 shape，不需要单独 OpenAPI 文件]

## 边界情况

- 并发调用：无共享状态，天然安全
- 时钟漂移：不做 NTP 校准，返回的是容器内 Node 进程视角的当前时间
- 时区为空：在极端容器环境下 `Intl` 可能返回空字符串，需兜底返回 `"UTC"`
- 响应类型：必须 JSON（不是 text/plain）

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/time` 路由
- 新增至少一组测试用例覆盖响应 shape
- 在系统文档登记该端点

**不在范围内**:
- POST / PATCH / DELETE 方法
- 鉴权、限流、缓存
- 多时区转换（只返回服务端本地时区）
- 精度升级到毫秒 unix（本次只按约定返回秒）
- 前端 Dashboard 的时间显示改造

## 预期受影响文件

- `packages/brain/src/routes/time.js`: 新增路由模块，导出 Express Router
- `packages/brain/server.js`: 挂载 `/api/brain/time` 路由
- `packages/brain/src/__tests__/time.test.js`: 新增单元测试
- `docs/current/SYSTEM_MAP.md`: 登记新端点
