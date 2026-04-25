# Sprint PRD — 最小健康检查端点 GET /api/brain/health（harness 闭环验证）

## OKR 对齐

- **对应 KR**：KR-Harness-Loop（harness v2 端到端自动化闭环）
- **当前进度**：今晚 8 PR 修复后处于待验证状态
- **本次推进预期**：通过最小化、低风险的功能 Initiative，跑通"Planner → GAN 收敛 → Phase B 子 Task 派发 → Generator → 4 PR 合并 → Initiative phase=done"全链路，验证 zero human babysit

## 背景

今晚连续合入了 8 个 harness 修复 PR（含 dispatcher 抽出、tick watchdog 抽出、quarantine 跳过有 PR 的 task 等）。这些修复涉及调度核心路径，需要一个真实但低风险的 Initiative 把整条 harness 闭环跑一遍：从 Planner 起步，经 GAN 收敛、Phase B 自动派发 3-4 个子 Task、Generator 正确生成分支并 rebase main、最终 4 PR 合并、Initiative 自动转到 phase=done，全程无人工介入。

选择"最小健康检查端点"作为载体的原因：

- 范围足够小（单端点、JSON 响应），不会产生大 PR 触发拆分阈值
- 业务影响低，即便实现走形也不会损坏 Brain 现有路径
- 输出语义明确（status / uptime_seconds / version 三字段），易写可量化 DoD
- 真实有用：Brain 当前没有 `/api/brain/health` 路径，仅 `/health`（路由级），新增 `/api/brain/` 前缀路径后可被外部探针、Watchdog 直接探活

## 目标

新增一个最小、可被外部探活直接调用的 HTTP 端点 `GET /api/brain/health`，返回三字段 JSON `{status, uptime_seconds, version}`，且全过程由 harness 自动跑通 4 个 PR 合并到 main。

## User Stories

**US-001**（P0）: 作为运维 / 外部 Watchdog，我希望调用 `GET /api/brain/health` 得到结构化健康响应，以便判断 Brain 进程是否存活并确认其当前版本与运行时长。

**US-002**（P0）: 作为 harness 系统的维护者，我希望本 Initiative 在 Planner 提交后由系统自动完成"GAN 收敛 → Phase B 子 Task 派发 → 4 PR 合并 → Initiative phase=done"全过程，以便确认今晚 8 PR 修复后的闭环可在零干预下工作。

**US-003**（P1）: 作为后续接入方，我希望该端点的契约（路径、响应字段、字段类型）写入项目文档，以便不读代码即可理解。

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 端点可用性）:
- Given Brain 服务在端口 5221 正常启动
- When 外部发送 `GET http://localhost:5221/api/brain/health`
- Then HTTP 状态码为 200，响应 Content-Type 为 `application/json`，响应体为 JSON 对象，且至少包含三个字段：`status`、`uptime_seconds`、`version`

**场景 2**（US-001 — status 语义）:
- Given Brain 服务正常运行
- When 调用 `GET /api/brain/health`
- Then 响应中 `status` 字段为字符串 `"ok"`

**场景 3**（US-001 — uptime 单调）:
- Given Brain 服务正常运行
- When 间隔至少 1 秒先后两次调用 `GET /api/brain/health`
- Then 第二次的 `uptime_seconds` 严格大于第一次（数值类型，单位为秒，可为整数或浮点）

**场景 4**（US-001 — version 来自 package.json）:
- Given Brain 服务正常运行
- When 调用 `GET /api/brain/health`
- Then `version` 字段值与 `packages/brain/package.json` 中的 `version` 字段完全一致

**场景 5**（US-002 — 端到端闭环）:
- Given 本 Initiative 的 PRD 与 task-plan 已被 Brain 入库
- When harness 自动运行
- Then 不需要人工干预即可观察到：4 个 PR 全部合并到 main、Initiative 状态自动转为 `phase=done`、最终调用上述端点契约成立

## 功能需求

- **FR-001**: 在 Brain HTTP 服务上暴露路径 `GET /api/brain/health`
- **FR-002**: 响应体为 JSON 对象，必含字段 `status`（字符串）、`uptime_seconds`（数值）、`version`（字符串）
- **FR-003**: `status` 在进程正常运行时取值 `"ok"`
- **FR-004**: `uptime_seconds` 反映 Brain 进程自启动以来的真实运行秒数，随时间单调递增
- **FR-005**: `version` 来自 Brain 自身的 `package.json` 版本号（不写死、不复制）
- **FR-006**: 端点本身无副作用，不修改任何持久化状态
- **FR-007**: 该端点的契约（路径 + 三字段含义）必须在项目文档中可被检索到

## 成功标准

- **SC-001**: `curl -s http://localhost:5221/api/brain/health | jq .` 输出包含且仅评估 `status`、`uptime_seconds`、`version` 三字段是否齐全（其他字段不限）
- **SC-002**: 至少 1 个自动化测试覆盖 FR-002~FR-005，且能在 CI 上稳定通过
- **SC-003**: 4 个 PR（每 Task 1 个）全部由 harness 自动合并到 main，过程中无人工 push / merge / rebase
- **SC-004**: 该 Initiative 最终在 Brain 中的状态为 `phase=done`

## 假设

- [ASSUMPTION: Brain HTTP 框架仍是 Express 路由风格，新增端点遵循现有路由组织方式（按文件分组挂载到 `/api/brain` 前缀下）]
- [ASSUMPTION: Brain 进程版本号 SSOT 为 `packages/brain/package.json`，可通过 `require('../package.json').version` 或等价方式读取]
- [ASSUMPTION: 当前 Brain 已有进程启动时间戳或可用 `process.uptime()` 直接获取秒数]
- [ASSUMPTION: 项目文档路由表位于 `docs/current/README.md` 或 Brain 内部文档中，可被本 Initiative 改动]

## 边界情况

- 端点在 Brain 启动后但部分子系统（DB / Tick Loop）尚未就绪时仍应返回 200 + `status:"ok"`，因为本 Initiative 范围内 `status` 仅表达"HTTP 进程存活"语义；更细的子系统健康判定不在本次范围
- 调用方传入查询参数时应忽略，不报错
- 并发调用不应竞争或抖动响应字段类型

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/health` 路径
- 三字段 JSON 响应实现
- 至少一个自动化测试覆盖核心契约
- 文档更新（让契约可检索）

**不在范围内**:
- 数据库连接 / Tick Loop / 外部依赖的细粒度健康检查
- 现有 `/health` 端点的修改或废弃
- Watchdog / 外部探针接入侧改动
- 监控告警系统配置
- 鉴权 / 速率限制
- OpenAPI / Swagger 文档生成

## 预期受影响文件

- `packages/brain/src/routes/`（或等价位置）：新增健康路由模块
- `packages/brain/src/server.js`（或等价 Brain 入口）：将新路由挂载到 `/api/brain` 前缀
- `packages/brain/src/__tests__/` 下某个集成测试文件：新增覆盖 GET /api/brain/health 契约的测试
- `docs/current/README.md` 或 Brain 内部文档：在路由表 / 端点列表中加入新端点说明
