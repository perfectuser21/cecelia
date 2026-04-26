# Sprint PRD — Brain build-info 端点 + Harness 全 graph 闭环验证

## OKR 对齐

- **对应 KR**：Brain 自治化 / Harness v2 graph 化（基于最近 PR #2640、#2643、#2645、#2646 的演进方向推断）
- **当前进度**：Sprint 1 + Sprint 1.1 已 deploy；inferTaskPlanNode 兜底已合（commit 563388118）
- **本次推进预期**：补齐"运行时身份指纹"端点 + 在真实 fanout 场景下复跑闭环

## 背景

Sprint 1 与 Sprint 1.1 已经把 Phase B/C 全部并进 LangGraph，Planner 不出 task_plan 时也由 graph 自己拆 sub_task。现在缺一个面向运维与 CI 的"我是哪个版本、什么时候构建的、跑的是哪个 commit"的运行时身份指纹端点；同时这个 Initiative 自身的 4 个 Task 也作为一次真实 fanout 用例，跨 Phase A→inferTaskPlan→fanout→sub-graphs→join→final_e2e→END 的全链路在 graph 内闭环。

## 目标

让任何调用方可以通过 `GET /api/brain/build-info` 一次拿到 Brain 实例的版本、构建/启动时戳、git SHA 三项指纹信息；并在过程中验证 Harness graph 的端到端闭环。

## User Stories

**US-001**（P0）: 作为运维巡检者，我希望调一个 HTTP 端点拿到当前 Brain 的版本/SHA/build_time，以便快速判断线上跑的是哪一版代码。
**US-002**（P0）: 作为 Harness 自我验证者，我希望本 Initiative 的 4 个 Task 在 graph 内自然完成 fanout→join，以便确认 Sprint 1.x 的成果在多 Task 真实场景下不退化。
**US-003**（P1）: 作为 Dashboard / 监控集成方，我希望端点返回结构稳定的 JSON，以便上层组件直接渲染版本徽章。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Brain 进程在端口 5221 已正常启动
- When 执行 `curl -sS localhost:5221/api/brain/build-info`
- Then HTTP 200，响应体是 JSON，且至少包含 `version`、`build_time`、`git_sha` 三个字段，三者均为非空字符串

**场景 2**（US-002）:
- Given 本 Initiative 的 task-plan.json 已入库且包含 ≥2 个 sub_task
- When Harness graph 跑完 Phase A → inferTaskPlan → fanout → sub-graphs → join → final_e2e
- Then graph 在 END 节点终止，过程中不出现"task_plan 缺失需外部拆分"的回退路径

**场景 3**（US-003）:
- Given 端点已上线
- When 重复请求 100 次
- Then 三字段在同一 Brain 实例生命周期内保持稳定（version 与 git_sha 不变；build_time 不抖动）

## 功能需求

- **FR-001**: 在 `packages/brain/src/routes/build-info.js` 暴露一个 Express Router，挂载在 `/api/brain/build-info`
- **FR-002**: Router 返回 JSON，包含 `version`（取自 `packages/brain/package.json` 的 `version`）、`build_time`（Brain 进程启动时刻的 ISO-8601 字符串）、`git_sha`（取自构建/部署期注入的 git commit SHA，未注入时降级为 `unknown`）
- **FR-003**: 在 `packages/brain/server.js` 注册该路由，与现有 `/api/brain/manifest` 等路由风格一致
- **FR-004**: 端点必须可在不依赖数据库连接的情况下返回（仅静态/进程级数据）

## 成功标准

- **SC-001**: `curl -sS localhost:5221/api/brain/build-info` 返回 HTTP 200，body 解析为 JSON 后 `version && build_time && git_sha` 三者皆为非空字符串
- **SC-002**: 该 Initiative 在 Brain 跑完后，对应 task_plan 在 graph 内完整执行 fanout→join→final_e2e→END，无 fallback 拆分日志
- **SC-003**: 路由文件 `packages/brain/src/routes/build-info.js` 存在且导出默认 Router 实例

## 假设

- [ASSUMPTION: Brain 启动入口仍是 `packages/brain/server.js`，路由挂载语法保持 `import xxxRoutes from './src/routes/xxx.js'` + `app.use('/api/brain/xxx', xxxRoutes)`]
- [ASSUMPTION: git SHA 由部署/启动脚本通过环境变量（如 `GIT_SHA` / `BUILD_GIT_SHA`）传入，本 Initiative 不重做注入机制]
- [ASSUMPTION: `packages/brain/package.json` 的 `version` 字段为权威版本号，DevGate 已保证四处同步]

## 边界情况

- 环境变量未注入 git SHA → 返回 `git_sha: "unknown"` 而非报 500
- `package.json` 解析失败（极端情况）→ 路由内 try/catch，返回 500 + JSON 错误体（与 brain-manifest.js 风格一致）
- 进程被冷重启 → `build_time` 可以变化，文档明确为"本进程启动时刻"，调用方不应假设跨重启稳定

## 范围限定

**在范围内**:
- 新增 `packages/brain/src/routes/build-info.js`
- 在 `packages/brain/server.js` 注册路由
- 端到端 curl 验证三字段
- 借此 Initiative 跑通 Harness graph 的 fanout→join 闭环

**不在范围内**:
- 不修改 git SHA 注入机制（部署脚本/CI workflow 不动）
- 不引入新的数据库表或 schema 变更
- 不做前端 Dashboard 集成（留给后续 Initiative）
- 不重构 brain-manifest.js 或 selfcheck.js

## 预期受影响文件

- `packages/brain/src/routes/build-info.js`：新增，Express Router 实现
- `packages/brain/server.js`：新增 1 行 import + 1 行 `app.use` 挂载
