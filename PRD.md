# PRD — fix(brain): inline SKILL pattern in GAN prompt builders (Bug 6)

## 背景 / 问题

W23 实证（用 cecelia-harness-debug + systematic-debugging skill 链路定位）：

reviewer LLM 输出只 5 维 rubric（dod_machineability/scope_match_prd/test_is_red/internal_consistency/risk_registered），**没** v6.1 第 6 维 `verification_oracle_completeness`，**没** v6.2 第 7 维 `behavior_count_position`。

但 `packages/workflows/skills/harness-contract-reviewer/SKILL.md` 是 v6.2（含 7 维）✓。

**根因（systematic-debugging Phase 1+2 backward trace）**：
- `packages/brain/src/workflows/harness-gan.graph.js:205-274` `buildReviewerPrompt` 用 slash command `/harness-contract-reviewer` + **hardcode 53 行 5 维 rubric** in prompt
- LLM 同时收到 slash command（理论上指向 SKILL.md）+ 紧跟 hardcoded 5 维 rubric 指令
- LLM 听更具体的 → 输出 5 维
- → PR A v6.1 + PR C v6.2 SKILL.md 改动**被 brain code 覆盖**

`buildProposerPrompt` 同样用 slash command pattern（虽无 hardcode rubric，但 SKILL discovery 也可能不一致）。

对照 evaluator（一直工作正常）：`harness-initiative.graph.js` `evaluateNode` 用 `loadSkillContent('harness-evaluator')` + inline pattern，SKILL.md 是 SSOT。

## 成功标准

- **SC-001**: `buildProposerPrompt` 第一行是 `'你是 harness-contract-proposer agent。按下面 SKILL 指令工作。'`，不是 `/harness-contract-proposer`
- **SC-002**: `buildProposerPrompt` 含 `loadSkillContent('harness-contract-proposer')` 注入的 SKILL 完整内容
- **SC-003**: `buildReviewerPrompt` 第一行是 `'你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。'`
- **SC-004**: `buildReviewerPrompt` 含 v6.2 SKILL 的 7 维 rubric（`verification_oracle_completeness` + `behavior_count_position`）
- **SC-005**: `buildReviewerPrompt` 不再 hardcode `'按以下 5 个维度'` rubric 指令（删 53 行）
- **SC-006**: 40 个 unit test 全过 + 相邻 harness 测试不破坏
- **SC-007**: 派 W24 严 schema 任务：reviewer 输出 7 维 rubric → 卡住弱合同 REVISION

## 范围限定

**在范围内**：
- packages/brain/src/workflows/harness-gan.graph.js: import + buildProposerPrompt + buildReviewerPrompt
- packages/brain/src/__tests__/harness-gan-graph.test.js: TDD red→green

**不在范围内**：
- 改 SKILL.md（PR A + PR C 已改对，本 PR 让其真生效）
- 改 evaluator buildEvaluatePrompt（已经是 inline pattern）
- 改 generator prompt（buildGeneratorPrompt 在 harness-task.graph.js，单独评估）
- 加 prompt cache 优化（功能正确优先）

## 不做

- 不改 SKILL.md
- 不动 contract-verify / extractVerdict 等 downstream 逻辑
- 不修复 pre-existing harness-module-constants.test.js（unrelated）

## 测试策略

- **Unit**: `harness-gan-graph.test.js` TDD red→green 40 cases
- **Integration**: 不需要（buildXxxPrompt 是纯函数）
- **E2E**: 派 W24 严 schema 任务，看 reviewer 真用 7 维 rubric
- **smoke.sh**: 不需要（commit type fix:）

## 受影响文件

- `packages/brain/src/workflows/harness-gan.graph.js`
- `packages/brain/src/__tests__/harness-gan-graph.test.js`
- `docs/learnings/cp-0511090244-brain-gan-inline-skill.md`
