# Sprint PRD — fix loop judge FAIL 裁决注入下轮 evaluator TaskBundle

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（补齐 harness fix loop 反馈断链，减少空耗轮次与人审升级）

## 背景

issue 47c4434d / run 8783807c 实证：judge 判 `evidence_insufficient` FAIL 并点名缺失证据后，fix loop 重新 spawn evaluator，但其 TaskBundle.inputs 无任何 judge 反馈字段。evaluator 盲重跑交同一套证据，judge 原样再 FAIL，白耗一轮后升级人审。

根因：`packages/brain/src/orchestrator/dispatcher.js` 的 `buildInputs`（组装 evaluator bundle）不读取本 run 最近一次 judge FAIL 裁决内容。数据源本已就绪——ground-truth 已把本 run decisionLog 最近一条 `verdict:judge` 暴露为 `observed.judgeVerdict`，只是从未被 evaluator 分支消费。

## Golden Path（核心场景）

系统从 [同 run 已存在 judge FAIL 裁决] → 经过 [dispatcher 组装下轮 evaluator bundle] → 到达 [evaluator 拿到点名缺失证据并优先补齐]

具体：
1. 同一 harness run 中 judge 判 FAIL（failure_class=`evidence_insufficient`）并在 summary 点名缺失证据清单，fix loop / rerun 触发重新 spawn evaluator。
2. dispatcher `buildInputs(role=evaluator)` 读取本 run 最近一次 judge FAIL 裁决（`observed.judgeVerdict`），把上轮 judge summary（含点名缺失证据）+ `failure_class` + 轮次写入 `inputs.judge_feedback`，脱敏并按长度上限截断。
3. evaluator 收到含 `judge_feedback` 的 TaskBundle → 消费侧提示词要求优先补齐 judge 点名的缺失证据 → 下一轮 judge 拿到新证据不再原样 FAIL。

## 边界情况

- 本 run 无任何 judge verdict（首轮 evaluator）→ 不注入 `judge_feedback` 字段（字段缺席，非空对象）。
- 最近一次 judge verdict 为 PASS / 非 FAIL → 不注入。
- judge summary 超长 → 截断到长度上限，注入后 bundle 不得越过 256KB 传输闸。
- 仅注入最近一次 judge FAIL（不堆叠历轮），避免 bundle 膨胀。

## 范围限定

**在范围内**：
- `buildInputs` evaluator 分支：同 run 存在 judge FAIL 时注入 `inputs.judge_feedback`（summary + failure_class + round，脱敏截断）。
- 先写 failing 单测再修，测试永久进 CI 作回归。
- evaluator skill 消费侧提示词：含 `judge_feedback` 时优先补齐点名证据。

**不在范围内**：
- judge 侧逻辑、generator-fix 已有的 `evaluator_feedback`（不动）。
- provider resume / 持久会话（本期明确不做）。
- judge 证据消费窗口本身的口径变更。

## 假设

- [ASSUMPTION: `judge_feedback` 消费点为 evaluator skill 的 Step B-1 前置提示；真身 SSOT=zenithjoy-skills repo，monorepo 内改 `packages/workflows/skills/harness-evaluator/SKILL.md` 快照并按 `scripts/sync-skills-snapshot.sh` 流程回补。]
- [ASSUMPTION: 截断长度上限与脱敏复用现有 `sanitizeDiagnostic`；具体上限值由 proposer 在合同阶段锁定。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：`buildInputs` evaluator 分支注入 `judge_feedback`（读 `observed.judgeVerdict`）。
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`（或新增 `dispatcher-judge-feedback.test.js`）：failing test → 永久回归（有 judge FAIL 则注入且含 summary/failure_class；无则字段缺席；超长截断后 bundle ≤256KB）。
- `packages/workflows/skills/harness-evaluator/SKILL.md`：消费侧提示词——含 `judge_feedback` 时优先补齐点名缺失证据。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD DoD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无
- 版本要求: 无
- 传输上限: bundle 注入后不得越过 256KB 传输闸（`HARNESS_BUNDLE_MAX_BYTES`）；超长 judge summary 必须截断（PrepPRD DoD#2 显式）
- 可观测/脱敏: `judge_feedback` 写入前脱敏（复用 `sanitizeDiagnostic`），只注入最近一次

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest 单测 + bundle 字节体检）
# 期望验收点（自然语言）：
# 1) 构造同 run 已有 judge FAIL(evidence_insufficient) 场景 → buildTaskBundle(role=evaluator)
#    产出 inputs.judge_feedback，含裁决 summary 与 failure_class（及轮次）。
# 2) 构造无 judge verdict 场景 → inputs 不含 judge_feedback 字段。
# 3) 构造超长 judge summary → 注入后整包字节数 ≤ HARNESS_BUNDLE_MAX_BYTES（256KB），summary 被截断。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 三源合并去重 -->
- [证据分类] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」；`evidence_insufficient` 时优先走 evaluator 补取证（来源: area）
- [证据窗口] judge 证据消费窗口为前 8 条 × 600 字符；evaluator 产 `.brain-result.json` 必须把一手证据带足（来源: area）
- [验证时钟] Kernel existing PR evaluator validation clock adoption——evaluator 复用既有 PR 验证时钟（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史；journey 现有 ability 均为 planned 态）

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/ 编排层（dispatcher）+ 后端契约，无 UI/agent 协议/engine 介入，属自治后端流程。
## target_environment: local_api
## target_environment_reason: 纯 Brain 编排层单测 + bundle 字节体检，本地 evaluator 用 vitest + node 校验，无需真机（localhost:5221 / 本地 node）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定；task.ability_id 为空）
