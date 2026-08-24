# Sprint PRD — validation clock 按 fix 轮自动顺延（有界）[r70]

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除长跑 run 被 validation clock 误杀、需人工 psql 续命的一类稳定性缺口）

## 背景

`resolveValidationClock` 的 pipeline deadline 以 `spawn:generator` 原点起算固定 `timeout_seconds`（默认 5400s）。fix 轮多的 run 在管线仍健康推进时撞死线被判死，人工只能 psql 续命（r50/r51 手术实录）。本 sprint 让 clock 按 fix 轮自动顺延且有界。第十六次点火：r69 合同死锁（B-06 可写清单锁死 vs 4 道 CI 门禁互斥、无绿态可达）已按 generator 死局分析（attempt 56a09164）修正合同边界——本轮可写白名单必须显式含全部门禁产物，禁止锁死为仅实现文件。

## Golden Path（核心场景）

系统在一条多 fix 轮的 run 上，从 [generator-fix 派发] → 经过 [clock 以该 fix 轮为新原点顺延] → 到达 [管线健康时不被误杀；超限则照常判死]。

具体：
1. run 已进入 validation 阶段，`orchestrator_decision_log` 中先有 `spawn:generator`，随后陆续出现多条 `spawn:generator-fix`（每条即一次 fix 轮派发成功）。
2. `resolveValidationClock` 计算 deadline 时，以 hop 时序中**最后一条** `spawn:generator-fix` 为新原点重新起算 `timeout_seconds`（而非固定用首个 generator 原点）。
3. 顺延有界：累计顺延上限 6 次；从第 7 次 fix 轮起不再顺延，deadline 冻结在第 6 次顺延的原点，超时照常判死。
4. 纯函数可重放：结果只依赖传入的 decision_log 行的 `action` 与 `hop` 时序，不读时钟、不读外部状态，同输入必同输出。
5. 无 `spawn:generator-fix` 行时语义与今日完全一致（回归不变）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 无任何 `spawn:generator-fix` 行 → 行为与现状一致（首个 generator/verified_existing_pr 原点起算）。
- fix 轮恰好 6 次 → 第 6 次顺延生效；第 7 次及以后不再顺延。
- decision_log 乱序传入 → 必须按 `hop` 数值排序后再取原点，不依赖数组顺序。
- `spawn:generator-fix` 与非 fix 行交错 → 只有 generator-fix 计入顺延计数。
- `validation_clock_required` fail-closed 默认语义不得被削弱（见 Invariant）。

## 范围限定

**在范围内**：
- 仅改 `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 顺延逻辑。
- 新增冻结测试于 `tests/gp/f1/`，真 import 被改文件，禁 mock 被改的边。

**不在范围内**：
- 不改 `timeout_seconds` 默认值（5400s）。
- 不动人审 deadline。
- 不做真库 `loop.js` 集成接缝（登记进「未覆盖真实链路清单」，交后续 sprint）。

## 假设

- [ASSUMPTION: 一次「fix 轮派发成功」= decision_log 中一条 `action='spawn:generator-fix'` 行；无独立成功标记字段。]
- [ASSUMPTION: 顺延上限 6 指 generator-fix 原点最多前移 6 次，超限后 deadline 冻结在第 6 次原点。]
- [ASSUMPTION: 顺延同样复用 persistedClock 的一致性校验语义（detail 有 pipeline_started_at/deadline_at 时须自洽）。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：`resolveValidationClock` 顺延逻辑主体。
- `tests/gp/f1/step3-*.test.js`：新增 RED 冻结测试（gp-anchor 闸必需产物）。
- `packages/brain/package.json` / `package-lock.json` / `.brain-versions` / `DEFINITION.md`：版本 bump 四处同步（version-sync 闸必需）。
- `sprints/08250010-kernel-r70-validation-clock/**`：合同四件套（sprint-prd / contract-draft / contract-dod / 冻结测试）。
- `DoD.md`（或 sprint 内 DoD）：dod 闸必需产物。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node/jest 直跑）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node/jest 直跑冻结测试 + 断言退出码）
# 期望验收点（自然语言）：
#  1. 复刻 r50 场景（首 generator 原点 + N 条 generator-fix，N≤6 且管线健康）→ 旧逻辑判死、新逻辑存活（deadline 已顺延）。
#  2. 负向 A：generator-fix 超过 6 次 → deadline 冻结在第 6 次原点，超时照常判死。
#  3. 负向 B：无 generator-fix 行 → 结果与现状逐字节一致（语义不变）。
#  4. 纯函数可重放：同一 decision_log（含乱序 hop）多次调用返回一致 deadline。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 + 本 sprint 合同边界铁律合并 -->
- [fail-closed] 保留 `validation_clock_required` 默认 fail-closed；顺延逻辑不得使缺失原点时静默放行（来源: area — Kernel existing PR evaluator validation clock adoption）
- [planner-branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area — planner_role_branch）
- [合同边界] 可写白名单必须显式含全部 CI 门禁产物（tests/gp/f1/step3-*.test.js、package.json+package-lock.json+.brain-versions+DEFINITION.md、DoD、sprints/<dir>/**）；除此清单外禁建计划外文件；禁止把白名单锁死为仅实现文件（来源: 本 sprint r68/r69 双向教训）
- [纯函数] resolveValidationClock 只依赖入参 decision_log 的 action+hop，不读真实时钟/外部状态，可重放（来源: 本 sprint thin_prd 要求 3）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史 — journey golden-paths 均为 planned 态，无 done/working 已验收行为）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task 双源均空），PrepPRD 显式值优先 -->
- 超时/延迟: `timeout_seconds` 默认 5400s 不改；顺延上限 6 次（来源: thin_prd 显式）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 判死/顺延决策以 decision_log hop 时序为唯一可重放依据（来源: thin_prd 要求 3）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 orchestrator 逻辑，无 UI/agent 协议/engine 路径。
## target_environment: local_api
## target_environment_reason: 纯后端 kernel 纯函数，E2E 走本地 node/jest 直跑 tests/gp/f1/，无需真机/浏览器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
