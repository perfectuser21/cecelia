# Sprint PRD — 真身 Session Controller：每条 kernel run 一个常驻监护进程

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（补齐 harness 无人值守闭环的关键短板：run 崩溃自愈 + 终局自收尾）

## 背景

PR #4860 只交付了 Controller「户籍制度」：`controller_session_id` + lease 记账、`isOwnerlessRun` 无主判定、`reconcileOwnerlessKernelRuns` orphan-guard 收尸。但 Controller 本人不存在——`controller_session_id` 是 `randomUUID` 记账、无真实进程，lease 无人续租，Kernel fatal 只能等扫尸不能救活，merge 后收尾靠人肉（run `8783807c` 实证：human_review 期间 head 漂移把人审饿死，run `03bf5660` 实证：`ownerless_kernel_run_recovered:controller_lease_expired`）。本 sprint 给每条 kernel run 装一个**只监护不执行**的常驻 Controller 进程：第一个启动、最后一个退出。

## Golden Path（核心场景）

系统从 [createKernelRun] → 经过 [Controller 认领→监护→守局] → 到达 [task.result 回写 + Controller 退出]

具体：
1. `createKernelRun` 时先 spawn 一个本机 detach 守护进程（Controller，非 LLM session）；Controller 写 `controller_session_id=自身真实身份` 取得 ownership 后，才拉起 Kernel。
2. Controller 周期心跳续租 lease（可观测跨越两个续租周期）；Controller 死则 lease 自然过期，由现有 orphan-guard 兜底接管（现机制降级为后备，保持不动）。
3. 监护循环盯 Kernel 进程存活 / run phase / PR / CI；Kernel fatal 时按 `failure_class` 决策——可恢复类（进程崩溃/瞬时基础设施）重启 Kernel `resume`，不可恢复类（`assembly_fault`/合同失效）执行结构化终止并回传。
4. run 进入 `human_review` 等待期间，Controller 冻结该 PR 分支 push（防 head 漂移饿死人审）；人审裁决后解冻。
5. Controller 守到 PR merged + report 完成，回写 task result（`pr_url`/`merged`/终局摘要）后才退出；失败终局也结构化回传，禁无声消失。

Controller 全程**只监护不执行**：planner/proposer/generator/evaluator/judge 仍由 Kernel 派发，Controller 不绕 Gate、不改 Kernel 状态机权威。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- kill -9 Kernel：Controller 检测到并按 failure_class 分流；run 不得进入无主态。
- kill -9 Controller：lease 过期 → orphan-guard 兜底接管收尸（现有回归不回退）。
- Controller 从未成功启动：走 never_started 兜底，不覆盖已有 error_message/failure_reason。
- PR 处于 CONFLICTING：GitHub 静默不触发 CI，Controller 不得按 CI 卡死空等。
- 并发 run：每条 run 独立 Controller，台账/临时文件走会话独享路径，禁共享固定文件名互踩。

## 范围限定

**在范围内**：Controller 真身进程（spawn/ownership/lease 续租）、监护循环（Kernel 存活 + fatal 分流 resume/结构化终止）、human_review 期 push 冻结/解冻、终局 task.result 回写 + 退出。
**不在范围内**：Controller 亲自执行任何阶段工作、修改 Kernel 状态机权威、重写 orphan-guard 判据（仅降级为后备）、LLM-session 化 Controller。

## 假设

- [ASSUMPTION: Controller 为本机 detach 守护进程（child_process），非独立容器、非 LLM session]
- [ASSUMPTION: lease 续租周期沿用现有 `controller_lease_expires_at` 相关常量，不新定义 SLA 数值，除非 GAN 阶段用户指定]
- [ASSUMPTION: failure_class 分类沿用现有 harness 分类枚举（可恢复 vs assembly_fault/合同失效），不新增分类体系]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`: `_spawnKernelRuntime` 改为先 spawn Controller 再拉起 Kernel。
- `packages/brain/src/orchestrator/kernel-controller-lifecycle.js`: 续租/监护/fatal 分流/终局回写主体逻辑。
- `packages/brain/src/orchestrator/kernel-controller-daemon.js`（新增）: Controller 守护进程入口。
- `packages/brain/src/lib/kernel-liveness.js`: Kernel 进程存活探测复用/扩展。
- `packages/brain/src/orchestrator/human-review-class.js` / `pr-head-resolver.js`: human_review 期 push 冻结判据。
- `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js`（扩展 + 新增 failing test）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均为空数组）；PrepPRD 显式项优先 -->
- 超时/心跳: lease 续租周期 = 待定（PrepPRD 未指定，沿用现有 lease 常量）；验收须可观测≥2 个续租周期
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 失败终局必须结构化回传（写 task.result + Brain log），禁无声消失；各 phase 完成调 phase-event 记账

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；step/journey_feature 级为空。仅注入与本 sprint 直接相关项 -->
- [台账不入库] controller 台账 `.harness/progress.md` 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo（来源: area）
- [never_started 兜底] watchdog 对『从未启动的进程』必须走 never_started 分类兜底，且不覆盖已有 error_message/failure_reason（来源: area）
- [phase-event] relay 单 session 模式必须在各 phase 完成时调 `POST /api/brain/harness/phase-event` 记账（来源: area）
- [会话独享路径] 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证（来源: area）
- [PR CONFLICTING] PR 处于 CONFLICTING 状态时 GitHub 静默不触发 CI，不得按 CI 卡死空等（来源: area）
- [validation clock] Kernel 既有 PR 的 evaluator validation clock 采纳规则不得回退（来源: area）
- （另有 ~13 条 area 级 capture-triage 学习型 invariant 与本 sprint 无直接关联，未逐条注入）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现存 ability 均为 planned 态，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 按 local_api 填真实脚本（node child_process spawn 实测 + psql 校验 lease 续租）
# 期望验收点（自然语言）：
# 1) createKernelRun 后存在活 Controller 进程，controller_session_id 指向它，psql 观测 controller_lease_expires_at 跨 2 个周期被推进
# 2) kill -9 Kernel → Controller 按 failure_class 执行 resume 或结构化终止，run.phase 不进入无主态
# 3) kill -9 Controller → lease 过期 → reconcileOwnerlessKernelRuns 兜底接管（现有回归绿）
# 4) run 进入 human_review 后向 PR 分支 push 被 Controller 拒止/回滚，裁决后恢复
# 5) merge 后 Controller 完成 task.result 回写才退出，task.result 含 pr_url+merged
```

## journey_type: autonomous
## journey_type_reason: 全部改动落 packages/brain/（纯后端进程编排），无 UI/agent 协议/engine 触点。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + PostgreSQL，evaluator 本地 curl localhost:5221 + psql + node spawn 即可验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 ability_id/golden-path step）
