# Sprint PRD — Brain /api/brain/health 新增 docker_runtime 字段

**Task ID**: 0f7fec19-f9a7-41ac-81d8-81fc15be4503
**Sprint Dir**: sprints
**生成时间**: 2026-04-18

## OKR 对齐

- **对应 KR**：[ASSUMPTION: 无法从 Brain 上下文确认具体 KR 编号，推断对应"Brain 可观测性 / Docker 执行器能力"方向的 KR]
- **当前进度**：[ASSUMPTION: 未知 — `curl localhost:5221/api/brain/context` 在 Docker 容器内不可达（端口 5221 未暴露或 Brain 未运行）]
- **本次推进预期**：[ASSUMPTION: 一次性可观测性补齐，预计推进该 KR 5-10%]
- **说明**：Step 0 Brain API 不可达，本次任务与仓库内 `DoD.cp-04161607-docker-executor.md` 同方向，推断与 Docker 执行器 GA 所需"运行时健康暴露"相关。所有 OKR/上下文推断均已标注为 [ASSUMPTION]，由 Proposer 在合同阶段核实。

## 背景

Brain 通过 `/api/brain/health` 暴露各器官（scheduler / circuit_breaker / event_bus / notifier / planner）的运行状态，供监控面板与上游巡检系统消费。近期 Harness 体系引入 Docker 执行器（`DoD.cp-04161607-docker-executor.md`），容器化 runtime 成为任务执行链路的关键组件，但其健康状态目前不在 `/api/brain/health` 返回结构中，导致：

- 监控面板无法看到容器运行时是否可用
- 巡检脚本无法感知 Docker 执行器 down 时的退化
- 新入站 Harness 任务在 Docker runtime 异常时会直接失败而无前置警示

本次在 health 端点新增 `docker_runtime` 字段以关闭该观测盲区。

## 目标

让调用方通过 `GET /api/brain/health` 一次获取 Docker 运行时的健康与元信息，包括是否启用、是否可达、版本号，使监控与巡检无需额外端点即可判断 Docker 执行器是否可用。

## User Stories

**US-001**（P0）：作为 **运维/巡检系统**，我希望 `/api/brain/health` 返回 Docker 运行时状态，以便在 Docker daemon down 时第一时间收到告警，而不必等待 Harness 任务批量失败。

**US-002**（P1）：作为 **Dashboard 前端**，我希望在健康卡片里展示 Docker 运行时的 enabled / reachable / version，以便用户一眼看出 Docker 执行能力是否可用。

**US-003**（P2）：作为 **Harness Planner**，我希望在派发 docker-executor 任务前通过 health 端点预检 Docker 可用性，以便在不可用时自动降级到 host 执行器或阻塞任务创建。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）— Docker 可用：
- **Given** Docker daemon 正常运行，Brain 配置了 Docker 执行器
- **When** 调用方发起 `GET /api/brain/health`
- **Then** 响应 200，JSON 中存在 `docker_runtime` 字段，且 `docker_runtime.status === 'healthy'`、`docker_runtime.reachable === true`、`docker_runtime.version` 为非空字符串

**场景 2**（关联 US-001）— Docker 不可达：
- **Given** Docker daemon 停止或 socket 不可访问
- **When** 调用方发起 `GET /api/brain/health`
- **Then** 响应 200（端点本身不因 Docker down 而 500），`docker_runtime.status === 'unhealthy'`、`docker_runtime.reachable === false`，顶层 `status` 为 `degraded`

**场景 3**（关联 US-002）— Docker 未启用：
- **Given** 环境未配置 Docker 执行器（启用开关为 false 或相关 env 未设置）
- **When** 调用方发起 `GET /api/brain/health`
- **Then** `docker_runtime.enabled === false`、`docker_runtime.status === 'disabled'`，顶层 `status` 不受影响

**场景 4**（关联 US-001）— 超时保护：
- **Given** Docker daemon 响应缓慢
- **When** health 端点采集 Docker 运行时信息
- **Then** Docker 探测在 ≤ 2 秒内返回（超时视为 unreachable），health 端点整体响应时间 ≤ 3 秒

**场景 5**（关联 US-003）— 向后兼容：
- **Given** 既有消费者已依赖现有 health 响应结构（`status` / `uptime` / `active_pipelines` / `organs` / `evaluator_stats` / `tick_stats` / `timestamp`）
- **When** 新字段上线
- **Then** 既有字段名、类型、嵌套层级均不变，新增 `docker_runtime` 仅为追加字段，既有客户端零改动仍然工作

## 功能需求

- **FR-001**：`/api/brain/health` 响应 JSON 必须新增 `docker_runtime` 字段（顶层或 `organs` 下，由 Proposer 在合同阶段确定位置）。
- **FR-002**：`docker_runtime` 至少包含字段：`enabled`（bool）、`status`（enum: `healthy` / `unhealthy` / `disabled` / `unknown`）、`reachable`（bool）、`version`（string 或 null）、`error`（string 或 null，仅在 unhealthy 时填写）。
- **FR-003**：Docker 探测须有超时保护（≤ 2 秒），探测失败不得使 health 端点返回 500。
- **FR-004**：当 `docker_runtime.status === 'unhealthy'` 且 `docker_runtime.enabled === true` 时，顶层 `status` 聚合为 `degraded`（与现有 `circuit_breaker` open 时的聚合逻辑保持一致语义）。当 `disabled` 时不影响顶层 `status`。
- **FR-005**：既有字段（`status` / `uptime` / `active_pipelines` / `evaluator_stats` / `tick_stats` / `organs.scheduler` / `organs.circuit_breaker` / `organs.event_bus` / `organs.notifier` / `organs.planner` / `timestamp`）的名称、类型、嵌套必须保持不变。

## 成功标准

- **SC-001**：新测试用例覆盖"Docker 可用 / 不可达 / 未启用"三种状态，在 `packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 与 `golden-path.integration.test.js` 中新增断言，全部通过。
- **SC-002**：health 端点在 Docker down 场景下 p99 响应时间 ≤ 3 秒（由 Docker 探测超时保护）。
- **SC-003**：既有 health 断言（含 `organs.scheduler` / `organs.circuit_breaker` 结构、`status` 字段存在性）100% 保持通过，零回归。
- **SC-004**：`/api/brain/health` 对 `docker_runtime` 字段在三种状态下各返回一次真实场景 smoke 测试，结构符合 FR-002 定义。

## 假设

- [ASSUMPTION: Brain `/api/brain/context` 在容器内不可达（curl 连接失败），因此无法校验当前活跃 KR/任务/最近 PR，OKR 对齐基于任务描述与仓库内 `DoD.cp-04161607-docker-executor.md` 同主题推断]
- [ASSUMPTION: `docker_runtime` 命名指"Docker 容器执行器运行时健康状态"，而不是 Brain 自身运行在 Docker 里的进程健康（后者用 uptime 已覆盖）]
- [ASSUMPTION: 字段放置位置 — 推测放在响应顶层（与 `evaluator_stats`、`tick_stats` 并列）比嵌入 `organs` 更合适，因为 docker runtime 是执行基础设施而非 Brain 内部器官；但最终位置由 Proposer 在合同中定]
- [ASSUMPTION: 状态枚举取值 `healthy` / `unhealthy` / `disabled` / `unknown`，与现有 `organs.*.status` 风格一致]
- [ASSUMPTION: Docker 探测方式（socket / CLI / HTTP API）不在 PRD 范围，由 Proposer 选择 How]
- [ASSUMPTION: 无需新增鉴权 — health 端点沿用现有（无鉴权或与既有一致）]

## 边界情况

- Docker daemon 冷启动中（可达但 API 仍在初始化）：视为 `unhealthy` + `reachable: true` + `error: 'starting'`
- Docker 版本获取失败但 socket 可达：`reachable: true`，`version: null`，`status: 'healthy'` 不降级（version 仅是元信息）
- 多个 Docker endpoint 配置（如 remote docker host）：PRD 范围仅覆盖"默认 endpoint"，多端点为后续扩展
- 探测并发：health 端点被高频调用时，Docker 探测不得产生 N+1 I/O 风暴，需合理缓存（缓存策略由 Proposer 选择，PRD 仅要求 p99 ≤ 3s）
- health 端点本身 DB 查询失败：docker_runtime 探测独立，不应受 DB 查询失败影响（当前实现 catch 500，保持此行为）
- 并发探测：多个请求同时命中时，`docker_runtime` 返回结果语义一致（允许缓存，不允许部分字段错配）

## 范围限定

**在范围内**：
- `/api/brain/health` 响应 JSON 中新增 `docker_runtime` 字段
- `docker_runtime` 的字段定义（enabled / status / reachable / version / error）
- Docker 探测的超时与错误保护
- 顶层 `status` 聚合规则对 docker_runtime 的响应
- 现有 integration test 的新增断言

**不在范围内**：
- 新建独立端点（如 `/api/brain/docker/status`）
- Dashboard UI 展示 docker_runtime 的前端改造（属于 apps/dashboard，单独 sprint）
- Docker 执行器自身的功能/稳定性改造（已在 `DoD.cp-04161607-docker-executor.md`）
- Harness Planner 基于 docker_runtime 做预检与降级的调度逻辑（US-003 是未来场景，本 sprint 只提供数据）
- 告警 / 通知规则（notifier 侧基于此字段发告警是下一个 sprint）
- 多 Docker endpoint / Docker Swarm / K8s runtime 支持
- Docker 容器内进程的资源指标（CPU / Memory）— 那是 metrics 端点的职责

## 预期受影响文件

（基于 Step 0 仓库扫描推断；Proposer 在合同阶段验证实际路径与范围）

- `packages/brain/src/routes/goals.js`：health 端点实现在第 89-161 行，新字段 `docker_runtime` 的构造与聚合逻辑在此修改
- `packages/brain/src/__tests__/integration/critical-routes.integration.test.js`：现有 `GET /api/brain/health` 断言位于第 162-186 行附近，需追加 docker_runtime 结构断言
- `packages/brain/src/__tests__/integration/golden-path.integration.test.js`：第 390-399 行已有 health 端点的 organs 结构断言，需扩展覆盖 docker_runtime
- `packages/brain/src/__tests__/smoke.test.js`：若 smoke 测试涉及 health 响应 schema，需同步更新（Proposer 核实）
- [可能新增] `packages/brain/src/docker-runtime-probe.js` 或类似模块：Docker 探测实现细节由 Proposer 定（PRD 不规定实现路径）
- `DEFINITION.md` / `docs/current/`：如 health 响应 schema 是 SSOT 的一部分，需同步更新文档（Proposer 核实）

---

**PRD 结束** — 下一步：Proposer 基于本 PRD 起草 sprint-contract.md（How）。
