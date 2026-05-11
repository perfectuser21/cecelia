# PRD — fix(brain): buildGeneratorPrompt inline SKILL pattern (Bug 7)

## 背景 / 问题

W24 实证 generator 字段名漂移（PRD `{result, operation}` → generator `{factorial}`）—— W19→W24 一致 5/5 漂移。

cecelia-harness-debug Layer 2 SKILL Discovery 排查锁定：
- `harness-utils.js:147 buildGeneratorPrompt` 仍 slash command pattern
- generator prompt 2806 bytes（vs reviewer/proposer inline 后 14-40KB）
- prompt 含 "Step 6.5" 数 = 0

generator SKILL.md v6.1 Step 6.5 完全没传到 generator LLM。

**根因**：PR D 修了 buildReviewerPrompt + buildProposerPrompt，**漏了 buildGeneratorPrompt**（在 harness-utils.js 不在 harness-gan.graph.js）。

## 成功标准

- SC-001: buildGeneratorPrompt 第一行 inline agent 引导
- SC-002: prompt 含 SKILL 完整内容（"Contract Self-Verification"）
- SC-003: 任务数据嵌入
- SC-004: fix_mode 时含 "FIX mode" 标记
- SC-005: 10 unit test 全过
- SC-006: 派 W25 验：generator prompt > 14KB，含 Step 6.5

## 范围限定

**在范围内**：
- packages/brain/src/harness-utils.js: import loadSkillContent + 改 buildGeneratorPrompt
- packages/brain/src/workflows/__tests__/harness-utils.test.js: TDD red→green

**不在范围内**：
- 改 SKILL.md（v6.1 已对）
- 改其他 4 个 builder
- 抽 buildAgentPrompt helper（PR F）

## 不做

- 不改 SKILL.md
- 不抽通用 helper（PR F）

## 测试策略

- Unit: harness-utils.test.js TDD red→green
- E2E: 派 W25 验
- smoke.sh: 不需要

## 受影响文件

- `packages/brain/src/harness-utils.js`
- `packages/brain/src/workflows/__tests__/harness-utils.test.js`
- `docs/learnings/cp-0511125107-brain-generator-inline-skill.md`
