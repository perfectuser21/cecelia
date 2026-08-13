# Sprint PRD — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness fix loop 每轮真收敛，减少无效轮次与人审升级）

## 背景

issue 47c4434d、run 8783807c 实证：judge 判 `evidence_insufficient` 并点名缺失证据后，fix loop 重新 spawn evaluator，但其 TaskBundle.inputs 无任何 judge 反馈字段。evaluator 盲重跑交同一套证据，judge 原样再 FAIL，白耗一轮后升级人审。根因：`orchestrator/dispatcher.js` 的 `buildInputs`（组装 evaluator bundle 时）不读取本 run 最近一次 `verdict:judge` 的 FAIL 裁决内容。现有 `buildInputs` 已有先例——它会从 `observed.decisionLog` 读最近 `verdict:context_answer` 注入 `human_context`；本 sprint 按同一模式补上 judge 反馈回环。

## Golden Path（核心场景）

系统从 [fix loop / rerun 触发] → 经过 [dispatcher 读上轮 judge FAIL 裁决] → 到达 [evaluator 拿到点名证据清单，本轮优先补齐]

具体：
1. [触发条件] 同一 run 已存在一条 `verdict:judge` 且裁决为 FAIL（如 `evidence_insufficient`），fix loop / rerun 再次组装 `role=evaluator` 的 TaskBundle
2. [系统处理] `buildInputs(role=evaluator)` 从 `observed.decisionLog` 找最近一条 `action=verdict:judge` 的 FAIL 记录，注入 `inputs.judge_feedback`：`summary`（含点名的缺失证据清单，脱敏 + 长度上限截断）、`failure_class`、`round`（轮次）；仅注入最近一次
3. [边界处理] 本 run 无任何 judge verdict 时，**不注入** `judge_feedback` 字段（保持首轮 bundle 干净）
4. [可观测结果] 注入后整条 bundle 仍 ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`）；evaluator skill 消费 `judge_feedback` 后，本轮 `.brain-result.json` 携带此前缺失的一手证据，judge 不再原样 `evidence_insufficient` FAIL

<!-- Response Schema（judge_feedback 字段名/类型/截断上限）由 Proposer 在 GAN 阶段 Step 1.1 读 execution-contract 后 codify，Planner 只锚定行为。 -->

## 边界情况

- 同 run 多条 judge FAIL → 只取**最近一次**（按 hop 倒序），不累积历史裁决
- judge summary 超长 → 截断到设定上限，保证不撑破 256KB 传输闸
- judge 裁决为 PASS 或不存在 → 不注入 `judge_feedback`
- 首轮 evaluator（无历史 verdict）→ 字段缺省，行为与现状一致（不回退现有 bundle 结构）

## 范围限定

**在范围内**：
- `buildInputs` 在 evaluator bundle 注入 `judge_feedback`（读本 run 最近 judge FAIL）
- summary 脱敏 + 截断上限，保证 bundle ≤ 256KB
- evaluator skill 消费侧提示词：含 `judge_feedback` 时优先补齐点名证据（SSOT 同步，snapshot 按流程 sync）
- failing test 先行、永久进 CI（单测 + 256KB 回归）

**不在范围内**：
- 累积多轮 judge 反馈 / 反馈汇总
- generator、judge、planner 角色 bundle 的反馈注入
- judge 自身裁决逻辑、证据消费窗口（前 8 条 × 600 字符）改动
- fix loop 状态机 / 升级人审阈值改动

## 假设

- [ASSUMPTION: judge FAIL 裁决通过 `observed.decisionLog` 中 `action=verdict:judge` 的记录可读，其 detail 含 `summary` 与 `failure_class`，与现有 `verdict:context_answer` 读取路径同构]
- [ASSUMPTION: `judge_feedback.round` 取自 judge verdict 记录的 hop / round 元数据]
- [ASSUMPTION: Unified Map 未配置（payload 缺 map_scope/map_repo），scope 锚定仅依据 task 描述与 anchor，不做领域猜测]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：`buildInputs` 新增读本 run 最近 `verdict:judge` FAIL → 注入 `common.judge_feedback`（截断 + 脱敏），仅 evaluator 角色
- `packages/brain/src/orchestrator/dispatcher.test.js`（新建或就近）：failing test —— ① run 有 judge FAIL 时 `buildInputs(role=evaluator)` 产出 `inputs.judge_feedback` 含 summary + failure_class；无 judge verdict 时不含该字段 ② 超长 summary 下整条 bundle ≤ 256KB
- `packages/workflows/skills/harness-evaluator/SKILL.md`：消费侧提示词 —— TaskBundle 含 `judge_feedback` 时要求本轮优先补齐点名缺失证据（SSOT，snapshot 按流程 sync）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空（step/feature 两源均无）；下列为 task 显式 NFR + 相关 invariant 窗口 -->
- 传输闸: 注入后整条 TaskBundle ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`），超长 summary 必须截断
- 脱敏: judge_feedback.summary 落 bundle 前脱敏，不携带凭据/密钥
- 注入约束: 仅注入最近一次 judge FAIL，不累积
- 证据窗口对齐: judge 证据消费窗口为前 8 条 × 600 字符，evaluator 补证时一手证据须靠前（消费侧不改窗口本身）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空） -->
- [证据分类] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，`evidence_insufficient` 时优先走 evaluator 补证（来源: area）
- [证据前置] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 `.brain-result.json` 必须把一手证据放前面（来源: area）
- [验证命令实跑] 合同里的验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也退出 0（来源: area）
- （另有多条 area 级 capture-triage learning 与本 sprint 无直接关系，略）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无 done/working 状态历史 ability，仅 planned，无累积 FR）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl/vitest。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测 + 256KB 回归）
# 期望验收点（自然语言）：
#   1) 构造本 run 含一条 verdict:judge FAIL（evidence_insufficient，点名缺失证据）→ buildInputs(role=evaluator)
#      产出 inputs.judge_feedback，含裁决 summary 与 failure_class
#   2) 同场景无任何 judge verdict → inputs 不含 judge_feedback 字段
#   3) 超长 judge summary → 整条 bundle Buffer.byteLength(JSON.stringify) ≤ 256*1024，未触发 size 闸拒收
#   4) evaluator SKILL.md 含「judge_feedback 存在时优先补点名证据」提示词（snapshot 已 sync）
```

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/（dispatcher + 后端 skill SSOT），无 UI、无远端 agent 协议，属纯后端自治流程
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，验收走本地 vitest 单测 + bundle 字节数断言（本地 evaluator），无需真机/浏览器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
