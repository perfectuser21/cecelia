# Sprint PRD — Kernel telemetry：逻辑轮次与耗时账本

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

Kernel Harness 当前只能从零散计数看到 Planner 4 / Reviewer 5 / Generator 9，无法区分 logical cycle、retry、resume、recovery、invalid evaluation，也无法统一对齐 reporter 与 judge 的时间账本。部分 attempt 会长期停在 starting 或 running，`completed_at` 缺失后 UI/API 既看不出有效工作，也看不出系统损耗。本 sprint 以不改 Kernel 路由决策和合同冻结语义为前提，只补齐 attempt lineage、logical cycle、耗时账本、orphan 收口和查询 API。

## Golden Path（核心场景）

Kernel telemetry 账本：系统为每个 Harness attempt 写入可追溯 lineage 与统一时间字段 → lease 过期的 orphan attempt 被 resume 或结构化终结 → UI/API 按 task 聚合多个 run 后，可同时看到逻辑轮次、有效工作时间和系统损耗。

具体：
1. Kernel 新建的每个 attempt 都带 `logical_cycle_id`、`attempt_kind`、`retry_of_attempt_id`、`restart_reason`、`workstream_key`，并保持 additive schema，不覆盖既有真相源。
2. attempt 进入 `starting`、`running`、终态时，planner、generator、reviewer、evaluator、judge、reporter 都有统一起止时间；无法原生记录者必须明确 `derived` 标志。
3. lease 过期的 `starting` / `running` orphan attempt 会被 watchdog 或 resume 流程认领为新的 resume/recovery 链路，或被结构化终结，不能永久停留在 running。
4. 新查询 API 允许按 task 聚合多个 run，返回按 role 与 workstream 拆分的 `active_time_ms`、`wall_time_ms`、`wait_time_ms`、`retry_count`、`recovery_count`、`invalid_count`，并能恢复 logical cycle 视角。
5. 对本次 4-run fixture，原始 4 / 2 / 5 / 9 / 5 计数可被还原为 logical cycle、重试损耗、恢复损耗与无效评估；现有 Kernel 路由决策、合同冻结语义与生产真相源不变。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- additive migration 只允许新增列、索引、视图或查询对象；禁止改写既有列语义，禁止生产执行写入。
- orphan attempt 已过 lease 但已有新 owner 接管时，旧 attempt 不能被重复终结。
- reporter 或 judge 缺少原生开始/结束事件时，只能返回明确 `derived=true` 的时间，不能伪造原始时间戳。
- invalid evaluation 与 retry/recovery 必须来自结构化证据，不得从 agent 自然语言或日志猜测状态。
- task 聚合多个 run 时，取消、失败、恢复并存必须保持 lineage 可追溯，不能把不同 workstream 混成一个逻辑轮次。

## 范围限定

**在范围内**：`harness_attempts` additive migration；`attempt-store` lineage 与时间字段；orphan 收口；独立 metrics/query route；4-run fixture 与 PG/route/tests；dispatcher 最小 metadata 接线；Brain 版本账本同步。

**不在范围内**：Commander 状态、Memory、Directive、Harness Actor Inbox、唤醒逻辑、第二流程账本；Kernel 路由决策重写；合同冻结语义调整；run bootstrap/preflight 大改；生产数据库写入；自动 merge。

## 假设

- [ASSUMPTION: task.payload.thin_prd 为空，本 sprint 以 task.description 中明确的 Kernel telemetry hotfix 范围作为唯一 scope 锚点。]
- [ASSUMPTION: task.payload 未提供 ability_id，journey 历史与 step 级决策均为空，本 sprint 按独立 Kernel 后端热修复处理。]
- [ASSUMPTION: 4-run fixture 将以仓内回放/PG 集成测试形式固化，不要求 planner 在此阶段定义最终响应 schema。]

## 预期受影响文件

- `packages/brain/migrations/<next>_kernel_attempt_telemetry.sql`: 为 attempt lineage、logical cycle、restart reason、workstream key 与统一时间字段提供 additive migration。
- `packages/brain/src/orchestrator/attempt-store.js`: 补充 create / reclaim / complete / fail 路径上的 lineage、resume/recovery、时间账本写入。
- `packages/brain/src/harness-relay-watchdog.js` 或同类 orphan 收口入口：在 lease 过期后执行 resume 或结构化终结。
- `packages/brain/src/orchestrator/kernel-handlers.js`: 只做最小 metadata 接线，把 retry/resume/recovery 分类透传到 attempt store。
- `packages/brain/src/routes/harness*.js` 或独立 telemetry route: 暴露按 task 聚合 run 的 attempt telemetry 查询 API。
- `packages/brain/src/__tests__/migration-*.test.js`、`packages/brain/src/orchestrator/__tests__/attempt-store.test.js`: 覆盖 additive migration、lineage、orphan 收口与时间账本。
- `packages/brain/src/routes/__tests__/` 与 `packages/brain/src/__tests__/integration/`: 覆盖 API 聚合、多 run、4-run fixture 还原与 reporter/judge derived 标志。
- `packages/brain/DEFINITION.md`、`DEFINITION.md`、`.brain-versions` 及既有版本账本位置：同步 Brain 版本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: task 级 telemetry 查询应能在本地 PG 集成测试预算内完成，不能引入需要长轮询的同步接口。
- 频控: orphan 收口必须复用既有 lease/heartbeat 节奏，不新增高频后台扫描器。
- 版本要求: migration 必须 additive、可重复应用，并通过真实 PostgreSQL Red→Green；禁止生产执行。
- 可观测: 所有 retry/resume/recovery/invalid 分类只基于结构化字段或权威表投影；reporter/judge 缺原生时间时必须显式 `derived`。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [长等心跳] 长等待 attempt 必须持续更新 lease/heartbeat，避免存活 session 被误判为 failed 或 orphan。（来源: area）
- [失败恢复] watchdog_overdue 误标失败后的恢复路径必须可追溯，并以外部真相核查后安全重跑或结构化收口。（来源: area）
- [时间关系] 跨模块时间常数若存在大小依赖，必须显式声明并在测试中覆盖 lease、heartbeat、orphan 判定关系。（来源: area）
- [多轮扫描] 涉及周期性扫描与回收的逻辑，测试不能只覆盖冷启动；必须至少有一条真实多轮、状态不重置场景。（来源: area）
- [失败分支] 返回 `null` / `false` 表示失败的路径必须显式处理，不能靠 try/catch 掩盖 orphan 收口失败。（来源: area）
- [真境完成] 依赖真实 PostgreSQL 接缝的 migration 与聚合查询，未真验只能标 logic-done-pending，不能伪装 done。（来源: area）
- [环境假设] lease 秒数、时间窗口与 workstream 分类键不得写死环境假设值，必须来自现有配置或明确常量约束。（来源: area）
- [租户隔离] 若 telemetry 查询触达任务或租户域数据，查询与聚合必须保持租户隔离，不得跨租户混读。（来源: area）
- [日志脱敏] 账本与错误日志不得泄露 secrets、PII 或 agent 原始敏感内容。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
cd packages/brain
npx vitest run src/__tests__/migration-357-harness-attempts.test.js src/orchestrator/__tests__/attempt-store.test.js
npx vitest run src/__tests__/integration/kernel-wiring.pg.integration.test.js
npx vitest run src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js src/routes/__tests__/harness.routes.test.js
npx vitest run tests/regression/relay-50170af2/kernel-no-progress-integration.test.js tests/regression/relay-50170af2/d707-replay.test.js
bash scripts/devgate/check-version-sync.sh
```

验收出口：真实 PostgreSQL 下 additive migration Red→Green，attempt lineage 字段可查询；lease 过期的 orphan `starting` / `running` 被 resume 或结构化终结；task 聚合 API 能按 role/workstream 返回 active/wall/wait 时间与 retry/recovery/invalid 计数；reporter/judge 具备统一起止时间或 `derived` 标志；4-run fixture 中原始 4 / 2 / 5 / 9 / 5 计数可恢复为 logical cycle 与系统损耗；Kernel 路由决策和合同冻结相关既有回归不退化。

## journey_type: autonomous
## journey_type_reason: 任务聚焦 packages/brain 后端 Kernel telemetry、attempt store、watchdog 与查询 API，无前端或远端 agent 协议变更。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端与本地 PostgreSQL 接缝验收由本地 evaluator 执行，目标环境为 localhost Brain API + PG。
## journey_id: c9d5deb3-2736-4a99-946a-14d9326e01ae
## step_id: none（PrepPRD 未锚定）
