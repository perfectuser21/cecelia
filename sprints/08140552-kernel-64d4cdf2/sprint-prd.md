# Sprint PRD — Fleet Worker 实例隔离续修：quarantined 终态 + restart_reason 继承 + PG runtime 机械注入

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（Harness Fleet Worker 恢复链三处 P0 收口，去除假绿/死循环）

## 背景

续 task 4ccfe523（PR #4876，commit dfc16f6b988adb8ccf39b081d513ce2022c7e25d）落地了 Fleet Worker
attempt 隔离与过期 attempt 回收（`expired-attempt-reconciler`），留下三项 P0：quarantined 无终态分支落
兜底 `worker_attempt_state_unresolved`（死循环）；替补 attempt restart_reason 被污染成 `evaluator_failed`；
Dispatcher 硬编码 `runtime_resources.postgres=false`，Evaluator 拿不到真实 PostgreSQL。

## Golden Path（核心场景）

**RED-1：quarantined inspect = 确定终态**
1. 过期 attempt 回收器 inspect 到 worker 状态为 `quarantined`
2. 系统在**单个 PostgreSQL 事务**内：把该 attempt 标 `failed`，写入专属 `error_code`
   （区别于 `worker_attempt_state_unresolved`），并追加 append-only decision evidence
3. 可观测结果：回收器返回可派生替补的确定终态（如 `quarantined_terminalized`），
   Brain 据此 derive replacement；不再返回 `worker_attempt_state_unresolved`

**RED-2：基础设施失败替补的 restart_reason 继承真实原因**
1. attempt 因基础设施故障需替补（回收器返回 `worker_attempt_replacement_required_after_lease`
   / failure_class=`infrastructure_blocked`）
2. Dispatcher 派生替补 attempt 时，`restart_reason` 继承该真实基础设施原因
3. 可观测结果：替补 attempt 的 `restart_reason` = `infrastructure_blocked`
   或 `worker_attempt_replacement_required_after_lease`，**不被污染成 `evaluator_failed`**

**RED-3：contract_requirements.postgres 机械驱动 runtime_resources.postgres**
1. 任务 `contract_requirements.postgres=true`（本 sprint 自身 runtime_resources.postgres=true）
2. Dispatcher 组装 TaskBundle 时，由该需求机械推导 `runtime_resources.postgres=true`，
   不再对相关角色硬编码 `postgres:false`
3. 可观测结果：Evaluator 收到 `runtime_resources.postgres=true`，用真实 PostgreSQL 完成最终验收；
   真实 PostgreSQL 集成回归永久进 CI

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- quarantined 终态化事务失败（DB 不可达）→ 仍返回 infrastructure_blocked，不得半标 failed（原子性）
- restart_reason：commander/retry 已显式给原因时优先，不被 evaluator_failed 覆盖
- `contract_requirements.postgres` 缺省/false 时保持 postgres=false，不得无条件置 true
- 已有 `node_deps:true` 不得被 postgres 注入冲掉（只加 postgres 键，不整体替换 runtime_resources）

## 范围限定

**在范围内**：`expired-attempt-reconciler.js` quarantined 终态分支；`dispatcher.js` restart_reason
继承与 runtime_resources.postgres 机械注入；三项对应回归测试（含真实 PostgreSQL 集成回归进 CI）。
**不在范围内**：Fleet Worker 容器编排本体、provider 会话续接、workspace-manager quarantine 采集逻辑改造、
新增 error_code 之外的状态机重构。

## 假设

- [ASSUMPTION: 专属 error_code 命名由 Proposer 在合同阶段定名（如 `worker_attempt_quarantined_terminal`），
  Planner 不锁死字面]
- [ASSUMPTION: append-only decision evidence 复用 reconciler 现有 terminalize 单事务 + error_code 写入通道]

## 预期受影响文件

- `packages/brain/src/orchestrator/expired-attempt-reconciler.js`: 新增 quarantined 终态分支（RED-1）
- `packages/brain/src/orchestrator/dispatcher.js`: restart_reason 继承（RED-2）+ runtime_resources.postgres 机械注入（RED-3）
- `packages/brain/src/orchestrator/constants.js`: 可能新增 quarantined 专属 error_code/reason 常量
- `packages/brain/src/orchestrator/expired-attempt-reconciler.test.js`: RED-1 回归
- `packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`: RED-2/RED-3 真实 PG 集成回归

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本任务 golden-path/feature 两源均空）+ PrepPRD 显式 NFR -->
- 原子性: quarantined 终态化必须单个 PostgreSQL 事务完成（标 failed + error_code + append-only evidence 同事务）
- 真实环境验收: Evaluator 最终验收必须用真实 PostgreSQL，不得 mock（runtime_resources.postgres=true）
- CI 回归: 真实 PostgreSQL 集成回归必须永久进 CI，不得删除（对齐 Bug 修复流程铁律 #20）
- 可观测: 基础设施失败/终态化必须写 Brain decision evidence，失败原因语义准确不污染

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级三源合并去重；[capture-triage]/smoke-* 审计日志泄漏行按 Step 0.3 警告排除，仅注入 [系统] 级铁律 + 本任务直接相关 learning -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）——直接命中 RED-3 硬编码 postgres:false
- [真环境验收] 真环境验证才算 done（来源: area）——直接命中 RED-3 真实 PostgreSQL 验收
- [多租户默认] 测试默认多租户（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [凭据安全] API Key/Token 不入库不入日志（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [status枚举全仓库] status 枚举硬编码断言在 GAN 新增状态值时需全仓库 grep 一致更新（来源: area, 直接相关）
- [同语义同处理] 同一语义（如失败原因）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area, 直接相关）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey golden-paths 仅返回 planned 态 ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入
> （curl localhost:5221 + 真实 psql）。

```bash
# 占位：proposer 按 target_environment=local_api 填真实脚本（curl localhost:5221 + psql cecelia）。期望验收点：
# 1) inspected.status=quarantined 过期 attempt → 一次事务标 failed + 专属 error_code + append-only evidence，
#    返回可派生替补的确定终态；psql 查该 attempt status=failed 且不再出现 worker_attempt_state_unresolved
# 2) infrastructure_blocked 触发替补 → psql 查替补 restart_reason ∈
#    {infrastructure_blocked, worker_attempt_replacement_required_after_lease}，非 evaluator_failed
# 3) contract_requirements.postgres=true → TaskBundle.inputs.runtime_resources.postgres=true；真实 PG 集成回归进 CI
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端编排（orchestrator dispatcher/reconciler），无 UI/agent bridge/engine hooks
## target_environment: local_api
## target_environment_reason: 仅 packages/brain/ 后端 + 真实 PostgreSQL 验收，本地 evaluator 走 curl localhost:5221 + psql cecelia
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
