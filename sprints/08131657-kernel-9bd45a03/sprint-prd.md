# Sprint PRD — 真身 Session Controller：每条 kernel run 一个常驻监护进程

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（把 Controller 从"户籍记账"升级为"常驻监护进程"，堵住 kernel run 无声饿死/靠人肉收尾的闭环漏洞）

## 背景

PR #4860 只交付了 Controller 户籍制度（`controller_session_id` + lease 记账、`isOwnerlessRun` 无主判定、orphan-guard 收尸），但 **Controller 本人不存在**：`_spawnKernelRuntime`（`packages/brain/src/harness-skill-relay.js:241`）里 `controllerSessionId = deps.controllerSessionId ?? randomUUID()` 只是记账 UUID，无真实进程；lease 无人续租；Kernel fatal 只能等 orphan-guard 扫尸不能救活；merge 后收尾靠人肉（run 8783807c 实证，人审期 head 漂移把 run 饿死）。本 sprint 让每条 kernel run 启动一个**常驻 Controller 守护进程**，第一个启动、最后一个退出，全程监护但**只监护不执行**。

## Golden Path（核心场景）

系统从 [createKernelRun 入口] → 经过 [Controller 认领→拉起 Kernel→监护循环→人审守护] → 到达 [守到 merge 后回写 task result 才退出]

具体：

1. **触发**：`_spawnKernelRuntime` 被调用 → 先 spawn 一个本机 detach 守护进程作为真身 Controller（非 LLM session），Controller 取得 ownership（把 `controller_session_id` 写为自身进程身份）后**再**拉起 Kernel。
2. **续租**：Controller 周期心跳续租 lease（`controller_lease_expires_at` 被周期推进）；观测到连续两个续租周期 lease 持续有效。
3. **监护**：Controller 盯 Kernel 进程存活（复用 `assessKernelLiveness`）、run phase、PR/CI 状态。Kernel fatal 时按 `failure_class` 决策——可恢复类（进程崩溃/瞬时基础设施）重启 Kernel resume；不可恢复类（`assembly_fault`/合同失效）走 `structuredFailureReason` 结构化终止并回传，run 不进入无主态。
4. **人审守护**：run 进入 `human_review` 等待期间，Controller 冻结该 PR 分支 push（拒止/回滚向该分支的 push，防 head 漂移饿死人审）；人审裁决后解冻。
5. **终局出口**：Controller 守到 PR merged + report 完成，回写 task result（`pr_url` / `merged` / 终局摘要）后**才**退出；失败终局也必须结构化回传，禁无声消失。
6. **后备不变**：Controller 死（进程被 kill）→ lease 自然过期 → 现有 orphan-guard（`reconcileOwnerlessKernelRuns`）兜底接管收尸，作为降级后备保持不动。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **Controller 与 Kernel 同时死**：lease 过期后 orphan-guard 接管，不得双重接管/双重收尸。
- **人审期并发 push**：冻结窗口内多次 push 尝试都必须被拒止/回滚，解冻后恢复正常 push。
- **Kernel fatal 但 failure_class 未知/unknown**：liveness 返回 'unknown' 时不得误判为 dead 触发 resume（避免误重启存活 Kernel）。
- **merge 后 Controller 异常退出跳过 report**：终局回写必须在退出前完成，report 缺失即视为失败终局需结构化回传（area 铁律 e83b2f0d）。
- **Controller 台账文件**：Controller 若写进度台账，必须落在 git 追踪之外，禁随 sprint PR 带入 repo（area 铁律 933701a3）。

## 范围限定

**在范围内**：
- `_spawnKernelRuntime` 改为先 spawn 真身 Controller 守护进程再拉 Kernel；Controller ownership 写入 + lease 周期续租。
- Controller 监护循环：Kernel 存活探测 + fatal 分类决策（resume / 结构化终止）。
- 人审窗口 PR 分支 push 冻结/解冻。
- 终局 task result 回写 + 结构化失败回传后退出。

**不在范围内**：
- Controller 亲自执行任何阶段工作（planner/proposer/generator/evaluator/judge 仍由 Kernel 派发）。
- 绕过 Gate 或改动 Kernel 状态机权威。
- orphan-guard 现有收尸逻辑的行为改动（仅降级为后备，保持不动）。
- Kernel 本身的调度/派发逻辑。

## 假设

- [ASSUMPTION: Controller 真身为本机 detach 守护进程（如 `child_process.spawn(..., {detached:true})`），非独立 LLM session；进程身份（pid+host）即 ownership 凭据来源。]
- [ASSUMPTION: lease 续租周期沿用现有 heartbeat 节拍；"两个续租周期"以现有 `orchestrator_heartbeat_at` / lease TTL 配置为准，无显式数值时由 Proposer 向用户确认。]
- [ASSUMPTION: 人审期 push 冻结在 Controller 侧实现拒止/回滚，不依赖 GitHub 分支保护规则。]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：`_spawnKernelRuntime` 改为先 spawn Controller 进程再拉 Kernel；`createKernelRun` ownership 写入路径。
- `packages/brain/src/orchestrator/kernel-controller-lifecycle.js`：Controller 生命周期（续租/监护/fatal 决策/终局回写）主逻辑落点；复用 `structuredFailureReason` / `handleKernelProcessFatal` / `isOwnerlessRun`。
- `packages/brain/src/lib/kernel-liveness.js`：Kernel 存活探测（Controller 监护循环消费 `assessKernelLiveness`）。
- `packages/brain/src/harness-relay-watchdog.js`：lease/watchdog 与 Controller 续租的协同边界。
- `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js` 及新增集成/回归测试：先写 failing test，永久进 CI，禁 mock 被改的边。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql + 进程 spawn/kill）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 起 Controller/Kernel + psql 查 run 行 + kill -9 断言）
# 期望验收点（自然语言）：
# 1. createKernelRun 后：存在活 Controller 进程，run.controller_session_id 指向它，观测两个续租周期 lease 持续有效。
# 2. kill -9 Kernel 进程 → Controller 检测到 → 可恢复类执行 resume 或不可恢复类结构化终止，run 不进入无主态。
# 3. kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（现有回归不回退）。
# 4. run 进入 human_review 后向 PR 分支 push → 被 Controller 拒止/回滚 → 裁决后恢复 push。
# 5. merge 后 Controller 完成 task result 回写才退出，task.result 含 pr_url + merged。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空数组），PrepPRD 未提供显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；Proposer 阶段确认 Kernel fatal 检测延迟上限）
- 频控: lease 续租周期 = 现有 heartbeat 节拍（待 Proposer 从代码常量确认）
- 版本要求: 无
- 可观测: 失败终局必须结构化回传（`structuredFailureReason` 脱敏，不落 controller_session_id 以外凭据）；禁无声消失

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 sprint 无 step/journey_feature 级 invariant）；仅注入与 controller/kernel/merge/report 直接相关的铁律 -->
- [merge权归属] merge 权归 controller，generator/其它角色禁止自行 merge PR（来源: area, e8230eb5）
- [收尾不跳过] controller 可能在 merge(Step 6) 后异常退出跳过 report(Step 7)，终局 report 必须守到完成才退出（来源: area, e83b2f0d）
- [台账出repo] controller 进度台账 `.harness/progress.md` 必须保持在 git 追踪之外，禁随 sprint PR 带入 repo（来源: area, 933701a3）
- [无主核查] watchdog_overdue 标 failed 的 run 经 orphan requeue 时必须外部真相核查（查 PR/session 真状态），不得盲信标记（来源: area, 636296d4）
- [验证时钟] Kernel 对既有 PR 的 evaluator 验证须采用统一 validation clock（来源: area, ddca7267）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史——journey 下 ability 均为 planned，无 done/working 状态的已验收 golden_path）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端进程编排（Controller/Kernel 生命周期），无 UI 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 验收为本机 PG 集成测试 + 进程 spawn/kill + psql 查 run 行，执行位置 = 本地 evaluator（curl localhost:5221 + psql），无 Windows/浏览器/微信 RPA。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
