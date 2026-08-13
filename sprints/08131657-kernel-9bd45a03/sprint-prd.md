# Sprint PRD — 真身 Session Controller（每条 kernel run 一个常驻监护进程）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（kernel run 生命周期从"记账户籍"升级为"真身监护"，去掉人肉收尾）

## 背景

PR #4860 只交付了 Controller 户籍制度：`controller_session_id` + lease 记账、无主判定、orphan-guard 收尸；但 Controller 本人不存在——`_spawnKernelRuntime` 里 `controllerSessionId = deps.controllerSessionId ?? randomUUID()`，是纯 UUID 记账、无真实进程；lease 无人续租；Kernel fatal 只能等扫尸不能救活；merge 后收尾靠人肉（run 8783807c 实证；run 59a41559 以 `ownerless_kernel_run_recovered:no_controller_ownership` 失败）。本 sprint 让每条 kernel run 起一个常驻 Controller 进程，第一个启动、最后一个退出，只监护不执行。

## Golden Path（核心场景）

系统从 [createKernelRun 派发] → 经过 [Controller 认领→监护→守护] → 到达 [PR merged + task result 回写 + Controller 退出]

具体：
1. 触发：harness initiative 调 `createKernelRun`，`_spawnKernelRuntime` 先 spawn 一个常驻 Controller 进程（本机 detach 守护进程，非 LLM session）。
2. 认领：Controller 把 `controller_session_id` 写成自身真实身份（进程可被 lease 续租佐证），取得 ownership 后才拉起 Kernel；此后周期心跳续租 lease。
3. 监护循环：盯 Kernel 进程存活 + run phase + PR/CI 状态。Kernel fatal 时按 `failure_class` 决策——可恢复类（进程崩溃/瞬时基础设施）重启 Kernel resume；不可恢复类（assembly_fault/合同失效）执行结构化终止并回传。
4. 人审守护：run 进入 `human_review` 期间 Controller 冻结该 PR 分支 push（防 head 漂移饿死人审，run 8783807c 死因），人审裁决后解冻。
5. 出口：守到 PR merged + report 完成，回写 task result（`pr_url` / `merged` / 终局摘要）后 Controller 才退出；失败终局也结构化回传，禁无声消失。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry / kernel-liveness 后推导，Planner 不定义技术规范。 -->

## 边界情况

- kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（现有机制降级为后备，回归不回退）。
- kill -9 Kernel → Controller 检测到并按 failure_class 分流，run 不进入无主态。
- 从未成功启动的 Controller/Kernel → 走 never_started 兜底，不覆盖已有 error_message/failure_reason。
- 并发多 run → 每 run 独立 Controller，互不串台账。

## 范围限定

**在范围内**：Controller 真身进程 spawn + ownership 认领 + lease 心跳续租 + 监护循环（存活/phase/PR-CI）+ failure_class 分流恢复/终止 + human_review 期间冻结 PR push + 终局 task result 回写后退出。
**不在范围内**：Controller 亲自执行任何阶段工作（planner/proposer/generator/evaluator/judge 仍由 Kernel 派发）；绕 Gate；改 Kernel 状态机权威；orphan-guard 现有机制改写（仅保持为后备）。

## 假设

- [ASSUMPTION: Controller 为本机 detach 守护进程即可，不需要独立 LLM session（据交付范围1）。]
- [ASSUMPTION: lease TTL / 续租周期沿用 PR #4860 既有实现（packages/brain/src/lib/harness-orphan-guard.js，idleMinutes=15 backstop），Proposer 读代码确定具体心跳间隔。]
- [ASSUMPTION: failure_class 取值沿用现有 kernel-liveness / 合同失效判定枚举，不新造分类体系。]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：`_spawnKernelRuntime` 改为先 spawn Controller 进程再拉起 Kernel，ownership 写真身。
- `packages/brain/src/lib/kernel-liveness.js`：监护循环盯进程存活 / failure_class 分流。
- `packages/brain/src/lib/harness-orphan-guard.js`：确认降级为后备，回归不回退。
- `packages/brain/src/harness-initiative-patrol.js`：spawn 链路对齐。
- `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js`（及 kernel-controller-ownership / orphan-run-revival）：新增 failing 集成回归。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + 进程/信号观测）。

```bash
# 占位：proposer 将填入真实 local_api 脚本
# 期望验收点（自然语言）：
#  1. createKernelRun 后存在活 Controller 进程，controller_session_id 指向它，lease 观测两个续租周期被刷新。
#  2. kill -9 Kernel → Controller 按可恢复类 resume 或不可恢复类结构化终止，run 不进入无主态。
#  3. kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（现有回归不回退）。
#  4. run 进入 human_review 后向 PR 分支 push 被 Controller 拒止/回滚，裁决后恢复。
#  5. merge 后 Controller 回写 task.result（含 pr_url + merged）才退出。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均为空数组），PrepPRD 显式值优先 -->
- 超时/延迟: lease 心跳续租须在既有 lease TTL 过半前完成（TTL 值沿用 PR #4860，Proposer 读代码确定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 终局（成功/失败）必须结构化回写 task result，禁无声消失（来源: PrepPRD 交付范围4）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step（空）+ journey_feature（本 journey 无匹配）+ area 三源合并去重 -->
- [PR验证时钟] Kernel 对既有 PR 采用 evaluator validation clock adoption（来源: area）
- [controller台账] controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo（来源: area）
- [watchdog兜底] watchdog 对『从未启动的进程』必须走 never_started 分类兜底，且不覆盖已有 error_message/failure_reason（来源: area）
- [relay心跳] relay 单 session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写心跳（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅涉 packages/brain harness 运行时（kernel/controller 进程调度），无 UI、无远端 agent 协议、无 engine hooks，落 autonomous 默认档。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 后端进程 + Brain API + DB，非 playground/前端/Windows/微信/远端部署，E2E 在本地 evaluator 用 curl localhost:5221 + psql + 进程信号观测。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
