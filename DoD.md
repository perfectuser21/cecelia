# DoD — fix(brain): inline SKILL pattern in GAN prompt builders (Bug 6)

## ARTIFACT 条目

- [x] [ARTIFACT] harness-gan.graph.js 含 `import { loadSkillContent }`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('import { loadSkillContent }'))process.exit(1)"`

- [x] [ARTIFACT] buildProposerPrompt 用 inline SKILL pattern（不再有 slash command）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes(\"loadSkillContent('harness-contract-proposer')\"))process.exit(1)"`

- [x] [ARTIFACT] buildReviewerPrompt 用 inline SKILL pattern
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes(\"loadSkillContent('harness-contract-reviewer')\"))process.exit(1)"`

- [x] [ARTIFACT] buildReviewerPrompt 不再 hardcode 5 维 rubric（'按以下 5 个维度' 不存在）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(c.includes('按以下 5 个维度'))process.exit(1)"`

- [x] [ARTIFACT] Learning 文件含必备段
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0511090244-brain-gan-inline-skill.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] buildProposerPrompt 第一行是 inline agent 引导
  Test: tests/harness-gan-graph.test.js (`buildProposerPrompt > inline SKILL pattern`)

- [x] [BEHAVIOR] buildReviewerPrompt 第一行是 inline agent 引导 + SKILL 含 7 维 rubric
  Test: tests/harness-gan-graph.test.js (`buildReviewerPrompt > inline SKILL (含 7 维 rubric) + 删 hardcoded 5 维`)

- [x] [BEHAVIOR] 40 个 harness-gan-graph 测试全过
  Test: `manual:bash -c "cd packages/brain && npx vitest run src/__tests__/harness-gan-graph.test.js 2>&1 | grep -E 'Tests.*40 passed'"`

## 成功标准（runtime acceptance — PR 合并后由 W24 验）

- [ ] PR 创建 + CI 全绿
- [ ] PR merged 到 main
- [ ] 派 W24：reviewer R1 输出 rubric_scores JSON 含 7 个 key（含 verification_oracle_completeness + behavior_count_position）
- [ ] 如果 contract 缺 [BEHAVIOR] → reviewer 第 7 维 < 7 → REVISION（不再 R1 直接 APPROVED）

## 不做

- 不改 SKILL.md
- 不改 evaluator pattern（已正确）
- 不修 pre-existing harness-module-constants.test.js
