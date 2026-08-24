# Sprint PRD — kernel validation clock 按 fix 轮自动顺延（有界）[r69]

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除长跑 run 被 validation clock 误杀、需人工 psql 续命的稳定性缺口）

## 背景

`resolveValidationClock`（`packages/brain/src/orchestrator/validation-clock.js`）以**第一个** validation origin（首个 `spawn:generator` intent 的 hop）为原点，deadline = `pipeline_started_at + timeout_seconds`（默认 5400s）。此后每个 `spawn:generator-fix` 都通过 `persistedClock` 复用这条固定 deadline。结果：fix 轮多的 run 在管线仍健康推进时撞死线被判 `automation_deadline_exceeded`（loop.js:636 `deadlineExceeded`），人工只能 psql 手改 deadline 续命（r50/r51 手术实录）。第十五次点火：r68 死于 fix 轮把测试复制进合同外 `tests/regression/**`（越权，impact gate 正确拦截但判 non-retryable 终局）且 fix commit 未推远端而回执自报 completed。本轮 thin_prd 显式禁止一切合同外路径写入。

## Golden Path（核心场景）

系统（orchestrator loop）在 fix 轮密集的长跑 run 中解析 validation clock：从 [首个 generator intent] → 经过 [多轮 generator-fix 顺延死线] → 到达 [健康推进的 run 存活 / 超界的 run 照常判死]。

具体：
1. **触发**：orchestrator 在派发决策处调用 `resolveValidationClock({ action, decisionLog, intentAt, timeoutSeconds })`（loop.js:1552）。
2. **首个 generator**：clock 原点 = 首个 `spawn:generator` 的 hop，deadline = 原点 + `timeout_seconds`（**行为不变**）。
3. **每次成功的 generator-fix 顺延**：每个新出现的 `spawn:generator-fix` 派发行为，成为**新的 clock 原点**，deadline 按该 fix 行的 decision-log 时序重算 = `该 fix 时间 + timeout_seconds`（**本次新增**）。
4. **顺延有界**：最多顺延 **6 次**；第 7 次及以后的 fix **不再**推进原点，deadline 停在第 6 次 fix 的锚点，超界后照常判死。
5. **纯函数可重放**：解析结果只依赖 `orchestrator_decision_log` 行的 `action` + `hop` 时序（+ 各行持久化时间），无墙钟状态，同一 decisionLog 多次解析结果逐字节相同。
6. **可观测出口**：返回的 `deadline_at` 随合法 fix 轮前移（≤6 次），使 loop.js `deadlineExceeded()` 在管线健康推进时不再误触（复刻 r50 场景：旧逻辑判死 → 新逻辑存活）。

## 边界情况

- **0 fix 轮**：语义与今日完全一致，deadline 锚在首个 generator（负向回归断言）。
- **恰好 6 fix 轮**：deadline 锚在第 6 个 fix。
- **7+ fix 轮**：第 6 个 fix 为最后锚点，其后 fix 不移动 deadline → 最终判死（负向：超限判死）。
- **verified_existing_pr evaluator origin** 路径与 `allowEvaluatorOrigin` 分支语义保持不变。
- **持久化一致性**：`persistedClock` 的 detail 行在重放时仍需与纯函数重算结果一致（可重放不变量）。

## 范围限定

**在范围内**：
- 仅修改纯函数 `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 顺延与有界逻辑。
- RED 先行的冻结回归测试，落 `tests/gp/f1/`，**真 import** `packages/brain/src/orchestrator/validation-clock.js`，禁 mock 被改的边。

**不在范围内**：
- 不改 `timeout_seconds` 默认值 5400。
- 不动人审 deadline / human-review pause 分支。
- loop.js 真库集成接缝**本 sprint 不做真实链路 E2E**，仅在合同登记「未覆盖真实链路清单」。

## 假设

- [ASSUMPTION: 顺延上限为固定常量 6 次（thin_prd 明确），不从 payload 读取。]
- [ASSUMPTION: 「成功派发」以 decision-log 中出现该 `spawn:generator-fix` 行为准（纯函数不感知运行时派发副作用）。]
- [ASSUMPTION: 顺延原点取各 fix 行的持久化时间（与现有 `persistedClock`/`exactClock` 同源），保持可重放。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：`resolveValidationClock` 增加按 fix 轮有界顺延逻辑。
- `tests/gp/f1/<validation-clock-fix-extend>.test.js`：RED 先行冻结回归测试（真 import，复刻 r50 + 负向）。
- 合同四件套 `sprints/08241610-kernel-r69-validation-clock/{sprint-prd.md,contract-draft.md,contract-dod.md}` 由 GAN 链产出并 commit 进 propose 分支。

> ⚠️ **合同外路径铁禁（r68 死因）**：全程只允许写上列合同 claim 的路径。**严禁**在 `tests/regression/` 或任何合同外目录创建测试副本/影子文件；fix commit 必须真实推上远端，回执不得在未推远端时自报 completed。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（ability_id=null，golden-path/feature NFR 均空）；以下取自 thin_prd 显式约束（主源优先） -->
- 超时/延迟: `timeout_seconds` 默认 5400s **不变**；顺延不改默认值。
- 顺延上限: 6 次（有界），超限照常判死。
- 可观测: 顺延结果必须为纯函数、仅依赖 `orchestrator_decision_log` 行 hop 时序，可重放。
- 版本要求: 无。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line 无 feature 级：ability_id=null）；仅注入与本 kernel/harness 后端任务相关的铁律 -->
- [validation-clock 采纳] Kernel existing PR evaluator validation clock 采纳规则不得被顺延逻辑破坏（来源: area）
- [vitest include 范围] 合同验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 0，测试文件必须落在 vitest include 范围内（来源: area）
- [generator 重试身份] `generator_infrastructure_retry_identity` 不变（来源: area）
- [planner 分支] `planner_role_branch`：使用服务端签发的 PLANNER_BRANCH，禁自行 checkout（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey 内仅 planned 态 ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。**最终可执行脚本由 proposer 在 GAN 阶段产出**（target_environment=local_api → vitest 本地）。

```bash
# 占位：proposer 按 local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. RED 先行——旧 validation-clock.js 上运行 tests/gp/f1 新测试：复刻 r50 fix-heavy 场景断言「run 存活」应 FAIL（旧逻辑判死）。
# 2. GREEN——顺延逻辑落地后同测试全绿：r50 场景存活；0 fix 轮语义不变；6 轮锚定；7+ 轮超限判死。
# 3. 真 import 断言：测试直接 import packages/brain/src/orchestrator/validation-clock.js，无 mock 被改的边（red-purity）。
# 4. exit-code 语义：新测试文件落在 vitest include 范围内，非空匹配，绿/红态如实反映（防 include 范围外假绿）。
# 5. 合同外路径零写入：diff 仅含合同 claim 路径，tests/regression/ 及任何合同外目录无新增文件。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端 orchestrator 纯函数与单元测试，无 UI/agent 协议/engine。
## target_environment: local_api
## target_environment_reason: 纯后端 kernel 逻辑，验收在本地 evaluator 跑 vitest（+ 可选 curl localhost:5221 / psql 核对），无浏览器/Windows/微信/远端部署。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
