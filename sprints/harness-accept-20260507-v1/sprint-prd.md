# Sprint PRD — Harness LangGraph 可靠性 Acceptance Baseline

## OKR 对齐

- **对应 KR**：harness-langgraph-reliability initiative（W8 端到端 acceptance）
- **当前进度**：W1+W3+W4+W6+W7.7 已 PR 合并（见 commits 18e74d75e / 6cc132b0a / dd21e0e58 / 3b113684d），W8 acceptance baseline 未跑
- **本次推进预期**：交付 acceptance walking skeleton 的最小 thin feature（health endpoint），让后续 W8 故障注入 / 14 节点贯穿验证能挂在一个真实的最小 initiative 上跑

## 背景

参见 `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md` §4.1。

W1+W3+W4 已让 LangGraph 可靠性原语生效（thread_id 版本化 / watchdog / streamMode），但整套 14 node 是否在真实 harness_initiative 任务里端到端跑通、子 PR 是否能自动 open + CI 绿 + main merged，需要一个最小 walking skeleton initiative 来证明。"派一个 thin feature 任务，让 harness 自己把它做完"是这个 initiative 的可交付物本身——不是 mock，不是 unit test，而是真跑一遍。

本 sprint 是 acceptance 跑动所需要的"那个 thin feature"。功能简单到不可能写错，但代码必须真的存在 + 真的能被 curl 命中，否则 acceptance 的 E2E smoke 不成立。

## Golden Path（核心场景）

运维 / Brain 自检脚本 → `curl localhost:5221/api/brain/harness/health` → 拿到 200 + JSON body 包含 LangGraph 版本号

具体：
1. **触发条件**：Brain 进程已起来（端口 5221 在听）
2. **系统处理**：Express 路由命中 `GET /api/brain/harness/health`，从 `@langchain/langgraph` 包元数据读出版本号，组装响应 body
3. **可观测结果**：HTTP 200，响应 body 是合法 JSON，至少包含三个字段：`langgraph_version`（字符串，如 `"1.2.9"`）、`last_attempt_at`（ISO 时间戳或 `null`）、`healthy: true`

## 边界情况

- LangGraph 包元数据读不到版本号 → `langgraph_version` 字段返回 `"unknown"`，仍返回 200 + `healthy: true`（health endpoint 不能因为版本探测失败就 503，否则会污染 Brain 整体健康信号）
- 没有任何 harness initiative 跑过 → `last_attempt_at` 为 `null`，端点仍 200
- 端点必须挂在已存在的 `app.use('/api/brain/harness', harnessRoutes)` 命名空间下（不能新建顶层路由前缀），保持运维路径一致

## 范围限定

**在范围内**：
- 新增路由处理函数：`GET /health`，挂在 `/api/brain/harness` 前缀下（最终路径 `/api/brain/harness/health`）
- 路由文件：`packages/brain/src/routes/harness-health.js`（新建）
- 在 `packages/brain/server.js` 注册新路由文件
- 响应 body 必须是 JSON，必须包含 `langgraph_version` / `last_attempt_at` / `healthy` 三字段

**不在范围内**：
- 故障注入（W8 acceptance 的故障场景 A/B/C）—— 那是 acceptance 跑动阶段做的事，不在本 thin feature 内
- LangGraph 14 node 全过验证 —— 由 acceptance 的 harness initiative 任务在自己跑动时由 Brain 自动完成
- 修改既有 `harness.js` / `harness-interrupts.js` 路由 —— 用独立文件避免污染
- Dashboard 前端展示该 health 字段 —— 不需要 UI
- 把该 endpoint 接入 readiness probe / 监控告警 —— 留给后续运维 sprint
- 业务功能（任何与 harness/health 无关的 feature）

## 假设

- [ASSUMPTION: `@langchain/langgraph` 在 `packages/brain/package.json` 已声明依赖，可通过读取 `node_modules/@langchain/langgraph/package.json` 或 `import` 元数据拿到 version 字段]
- [ASSUMPTION: `last_attempt_at` 的来源是 Brain 数据库里 harness initiative 任务的最近一次 `started_at`，但若查询失败可降级为 `null`，不阻塞 health 响应]
- [ASSUMPTION: 该 endpoint 不需要鉴权，与已有 `/api/brain/harness/*` 路由保持同样的访问策略]

## 预期受影响文件

- `packages/brain/src/routes/harness-health.js`：新建 Express Router，导出 `GET /health` 处理函数
- `packages/brain/server.js`：新增 `import harnessHealthRoutes from './src/routes/harness-health.js'` 与 `app.use('/api/brain/harness', harnessHealthRoutes)`（或追加到既有 harness 命名空间）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端路由，不触达 dashboard/engine/agent-remote
