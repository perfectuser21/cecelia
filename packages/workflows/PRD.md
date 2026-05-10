# PRD — [CONFIG] harness skills 协议对齐修订（W22 实证 5 处 skill 矛盾）

## 背景 / 问题

W22 实证 PR A 引入的 skill 修订**协议互相矛盾**：
- proposer SKILL Step 2b（PR A 没改的部分）说 BEHAVIOR 放 `tests/ws*/*.test.ts`
- evaluator SKILL v1.1 反作弊红线第 3 条（PR A 加的）说 "缺 [BEHAVIOR] Test 命令直接 FAIL"，evaluator 找的是 contract-dod-ws*.md 文件里的 [BEHAVIOR] 标签

W22 sub-evaluator 4 次 FAIL，feedback 明确："contract-dod-ws1.md 含 25 条 [ARTIFACT] + 0 条 [BEHAVIOR] 标签"，"## BEHAVIOR 索引 区块（指向 vitest）但 0 条内嵌可独立执行的 [BEHAVIOR] Test 命令"。

**根因不是 LLM 漂移，是我 PR A 没回头对齐 proposer 跟 evaluator 协议**。User 反馈"你 skill 没写好"——架构没问题，是 skill 协议设计互相矛盾。

同时观察到其他 skill 缺陷：
- planner Response Schema 没强约束 query param 名 → W22 generator 用 a/b 不用 base/exp
- reviewer 第 6 维只评 verification_oracle_completeness，不卡 [BEHAVIOR] 数量与位置 → W22 R1 直接 APPROVED 弱合同
- generator 没要求 push 前自验 contract → 推弱实现给 evaluator 兜底

## 成功标准

- **SC-001**: proposer SKILL v7.4 — DoD 分家规则改成 BEHAVIOR 放 contract-dod-ws*.md 内嵌 manual:bash（不放 vitest 索引）
- **SC-002**: planner SKILL v8.2 — Response Schema 段新增 Query Parameters 子段
- **SC-003**: reviewer SKILL v6.2 — rubric 加第 7 维 behavior_count_position（≥ 4 条 [BEHAVIOR]）
- **SC-004**: generator SKILL v6.1 — 加 Step 6.5 Contract Self-Verification（push 前自跑 manual:bash 全过）
- **SC-005**: 4 skill version bump + changelog 写明对齐 W22 实证 + 跟 PR A 协议互补
- **SC-006**: 派 W23 严 schema acceptance test：
  - 期望 A：generator 严守 contract → evaluator jq -e 全过 → task=completed
  - 或期望 B：generator 漂移但 reviewer 第 7 维 catch 在合同层（REVISION），或 generator 自验失败不 push
  - 不该出现的反模式：proposer 写 0 条 [BEHAVIOR] 还能 APPROVED（PR A 漏判）

## 范围限定

**在范围内**：
- packages/workflows/skills/harness-contract-proposer/SKILL.md（v7.3 → v7.4）
- packages/workflows/skills/harness-planner/SKILL.md（v8.1 → v8.2）
- packages/workflows/skills/harness-contract-reviewer/SKILL.md（v6.1 → v6.2）
- packages/workflows/skills/harness-generator/SKILL.md（v6.0 → v6.1）

**不在范围内**：
- evaluator SKILL v1.1（PR A 已改，本 PR 不动；新协议下 evaluator 找 DoD 文件 [BEHAVIOR] 是正确行为）
- packages/brain/src/ 任何代码（PR B 已修 verdict 传递）
- 加机器化 CI lint（属于 PR D 范围）
- 改 LangGraph orchestrator

## 不做

- 不改 evaluator SKILL（已对齐目标，proposer/reviewer/generator 跟它对齐）
- 不改 brain runtime
- 不动 W19/W20/W21/W22 历史合并 PR

## 测试策略

- **Unit**: SKILL.md 是配置文件，无可单测代码逻辑
- **Integration / E2E**: 派 W23 harness_initiative 真跑严 schema 任务作为 acceptance test
- **smoke.sh**: N/A（packages/workflows/ 不在 brain runtime 范围）

## 受影响文件

- 4 个 SKILL.md
- PRD/DoD（worktree 根 + packages/workflows/）
- docs/learnings/cp-0511074523-harness-skills-protocol-align.md
