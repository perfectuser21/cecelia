# DoD — [CONFIG] harness skills Anthropic harness-design 对齐

> [BEHAVIOR] tag 至少 1 条；push 前 [x] 全勾；feat PR 含 *.test.ts（本 PR 是 [CONFIG]，非 feat，无需测试）

## ARTIFACT 条目

- [x] [ARTIFACT] harness-planner SKILL.md 含 "## Response Schema" 段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('## Response Schema'))process.exit(1)"`

- [x] [ARTIFACT] harness-contract-reviewer SKILL.md rubric 含第 6 维 verification_oracle_completeness
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('verification_oracle_completeness'))process.exit(1)"`

- [x] [ARTIFACT] harness-evaluator SKILL.md 含反作弊红线段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('反作弊红线'))process.exit(1)"`

- [x] [ARTIFACT] harness-contract-proposer SKILL.md 含 Response Schema → jq -e codify 段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('Response Schema → jq -e codify'))process.exit(1)"`

- [x] [ARTIFACT] 4 个 skill 全部 version bump（planner v8.1 / reviewer v6.1 / evaluator v1.1 / proposer v7.3）
  Test: `manual:bash -c 'grep -E "^version: 8.1.0" packages/workflows/skills/harness-planner/SKILL.md && grep -E "^version: 6.1.0" packages/workflows/skills/harness-contract-reviewer/SKILL.md && grep -E "^version: 1.1.0" packages/workflows/skills/harness-evaluator/SKILL.md && grep -E "^version: 7.3.0" packages/workflows/skills/harness-contract-proposer/SKILL.md'`

- [x] [ARTIFACT] Learning 文件存在含必备段
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0510203649-harness-skills-anthropic-align.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] reviewer rubric 第 6 维 threshold 规则同步从 "5 维 ≥ 7" 改为 "6 维 ≥ 7"
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('全部 6 维 ≥ 7'))process.exit(1)"`

- [x] [BEHAVIOR] reviewer SKILL verdict JSON 输出格式含 verification_oracle_completeness 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('verification_oracle_completeness'))process.exit(1)"`

## 成功标准（runtime acceptance — 在 PR 合并后由 W21 测试验，不在本 PR DoD CI 范围）

- [ ] PR 创建 + CI 全绿（无 admin merge）
- [ ] PR merged 到 main
- [ ] 派 W21 严 schema /multiply 真跑：generator 漂移到 product → reviewer 第 6 维或 evaluator jq -e 抓住 → task 不会标 completed PASS

## 不做

- 不写 unit test（SKILL.md 是配置文件）
- 不改 brain runtime
- 不动 W19/W20 历史 PR 已合并的 contract 文件
