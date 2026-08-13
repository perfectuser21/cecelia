# Sprint PRD — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 fix loop 空耗一轮 + 人审升级的反馈断链）

## 背景

issue 47c4434d、run 8783807c 实证：judge 判 `evidence_insufficient` 并点名缺失证据后，fix loop 重新 spawn evaluator，但其 TaskBundle.inputs 无任何 judge 反馈字段，evaluator 盲重跑交同一套证据，judge 原样再 FAIL，白耗一轮后升级人审。

根因：`packages/brain/src/orchestrator/dispatcher.js` 组装 evaluator bundle 时（`buildInputs` 中 `spec.role === 'evaluator'` 分支）不读取本 run 最近一次 judge FAIL verdict。对照组：generator-fix 分支已有 `buildEvaluatorFeedback(observed)` 注入 `evaluator_feedback`，evaluator 分支缺少对等的 `judge_feedback` 注入。

## Golden Path（核心场景）

系统从 [judge 判 FAIL 并点名缺失证据] → 经过 [fix loop 重新组装 evaluator bundle] → 到达 [evaluator 拿到 judge_feedback 并优先补齐点名证据]

具体：
1. [触发条件] 同一 run 已存在一条 `verdict:judge` 的 FAIL 裁决（如 `evidence_insufficient`），fix loop / rerun 再次 spawn evaluator。
2. [系统处理] `dispatcher.js` 组装 evaluator TaskBundle 时读取本 run **最近一次** judge FAIL verdict，在 `inputs.judge_feedback` 注入：上轮 judge summary（含点名的缺失证据清单）+ `failure_class` + 轮次；脱敏后 summary 超长则截断，整包不得越 256KB 传输闸。
3. [可观测结果] evaluator skill 消费侧读到 `judge_feedback` 时，提示词要求**优先补齐 judge 点名的缺失证据**，不再盲交同一套证据。无 judge verdict 的首轮 evaluator，bundle 不含该字段（保持现状）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 本 run 无任何 judge verdict（首轮 evaluator）→ `inputs.judge_feedback` 不出现（不注入空对象/null 键）。
- 存在多条 judge verdict → 只注入**最近一次**，不做历史累积。
- judge summary 超长 → 脱敏 + 截断到上限，保证注入后整包 ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`）。
- judge verdict 非 FAIL（PASS）→ 不注入（无需反馈）。

## 范围限定

**在范围内**：
- `dispatcher.js` evaluator bundle 组装：新增 `judge_feedback` 注入逻辑（读本 run 最近 judge FAIL verdict）。
- summary 脱敏 + 长度上限截断，防 bundle 超 256KB。
- evaluator skill SSOT 消费侧提示词：含 `judge_feedback` 时优先补齐点名证据（snapshot 按流程 sync）。
- 先写 failing 单测 + 回归测，永久进 CI。

**不在范围内**：
- 修改 judge 判决逻辑本身、judge 证据消费窗口。
- generator-fix 的 `evaluator_feedback` 路径（已存在，不动）。
- 多轮 judge 反馈的历史累积/合并策略。

## 假设

- [ASSUMPTION: judge 裁决内容可从 `observed`（run 上下文）中按 `verdict:judge` + FAIL 取到最近一次，路径待 Proposer 从 case_file / verdict store 确认]。
- [ASSUMPTION: `failure_class` 与 `summary` 存在于 judge verdict 记录中（如 `evidence_insufficient`）]。
- [ASSUMPTION: 截断上限沿用现有 `sanitizeDiagnostic` 家族约定，具体字节数由 Proposer 定，须确保注入后整包 ≤ 256KB]。

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: evaluator 分支新增 `judge_feedback` 注入（对照 `buildEvaluatorFeedback`）。
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`: failing 单测 + 回归（有/无 judge verdict、256KB 截断）。
- `packages/workflows/skills/harness-evaluator/SKILL.md`: 消费侧提示词——含 `judge_feedback` 时优先补齐点名证据。
- （snapshot 镜像按 skills sync 流程同步，Proposer 确认目标路径）。

## NFR 约束

<!-- 来源: 任务描述（PrepPRD 显式）优先；decisions category=nfr 副源为空 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 传输闸: 注入 `judge_feedback` 后整包 ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`）；超长 summary 必须截断
- 脱敏: judge summary 注入前须脱敏（沿用 `sanitizeDiagnostic` 家族）
- 可观测: 仅注入最近一次 judge FAIL 裁决，无 judge verdict 时不注入

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 源（step/journey_feature 源为空）；只注入与本 sprint 直接相关的铁律 -->
- [证据补齐优先] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」；`evidence_insufficient` 时优先走 evaluator 补证据（来源: area）
- [证据消费窗口] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 `.brain-result.json` 必须把一手证据放进该窗口（来源: area）
- [local_api 免死锁] judge 机械闸⑤（meta_verification_gap）对 local_api / 无 UI smoke 任务会死锁，此类任务需在合同层规避（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；查得 ability 均为 planned 态，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node 单测 + 可选 curl localhost:5221 验证）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测 + bundle 字节断言）
# 期望验收点（自然语言）：
#   1. 构造「本 run 已有 judge FAIL verdict」的 observed，调 buildBundle(role=evaluator)，
#      断言 inputs.judge_feedback 含裁决 summary + failure_class + 轮次。
#   2. 构造「无 judge verdict」的 observed，断言 inputs 不含 judge_feedback 键。
#   3. 构造超长 judge summary，断言注入后 bundleByteLength ≤ 256*1024。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator/（纯后端调度逻辑），无 UI/远端 agent 协议改动，属自治后端。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + 单测验证，evaluator 在本地跑（vitest + curl localhost:5221），无浏览器/Windows/微信依赖。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
