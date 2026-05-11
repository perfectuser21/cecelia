# Learning — fix(brain): inline SKILL pattern in GAN prompt builders (Bug 6)

**日期**: 2026-05-11
**分支**: cp-0511090244-brain-gan-inline-skill
**类型**: fix（Brain runtime 真根因修复）

## 背景

W23 用刚写的 `cecelia-harness-debug` skill + `superpowers:systematic-debugging` 链路 5 min 内定位到 Bug 6。

之前 PR A v6.1 + PR C v6.2 改 SKILL.md 都"看似生效"但实际被覆盖。

### 根本原因

`packages/brain/src/workflows/harness-gan.graph.js` 用 slash command `/harness-contract-reviewer` + **hardcode 53 行 5 维 rubric instruction**。LLM 听具体指令 → 输出 5 维。SKILL.md 改 7 维**完全被 brain code 内嵌指令覆盖**。

evaluator 一直工作正常 — 它用 `loadSkillContent` + inline pattern，SKILL.md 是真 SSOT。

**反思 — 为什么之前几次修没找到这层**：
- PR A 修 SKILL.md 时只改 SKILL，没 grep brain code 是否同步 hardcoded
- PR C 同样
- 我没用 systematic-debugging 4 phases 直接修
- 直到 W23 用 cecelia-harness-debug 链路 5 min 定位

### 下次预防

- [x] 改 SKILL.md 必须 grep brain code 是否有同步 hardcoded 指令
- [x] Brain prompt builder 统一 inline pattern（不混用 slash command + hardcoded）
- [x] SKILL.md 是 SSOT，brain code 不复制粘贴 SKILL 内容
- [x] 任何"改 X 行为没变"必须先跑 cecelia-harness-debug Layer 2 discovery
- [x] PR review 时 grep 改 SKILL 的同时 brain code 是否有相关 hardcoded 指令

## 修复

import + buildProposerPrompt + buildReviewerPrompt 三处。删 53 行 hardcoded rubric。

## 验收锚点

PR 合并后派 W24，期望 reviewer 输出 7 维 rubric + proposer 写 ≥ 4 [BEHAVIOR] + 严 contract → generator 严守 → task=completed（结局 A）。
