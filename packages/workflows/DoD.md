# DoD — [CONFIG] harness skills 协议对齐修订

## ARTIFACT 条目

- [x] [ARTIFACT] proposer SKILL v7.4 DoD 分家规则改成 BEHAVIOR 放 DoD 文件
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('contract-dod-ws{N}.md\` 内 BEHAVIOR 段'))process.exit(1)"`

- [x] [ARTIFACT] planner SKILL v8.2 Response Schema 段含 Query Parameters 子段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('Query Parameters'))process.exit(1)"`

- [x] [ARTIFACT] reviewer SKILL v6.2 rubric 加第 7 维 behavior_count_position
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('behavior_count_position'))process.exit(1)"`

- [x] [ARTIFACT] reviewer 第 7 维硬阈值 ≥ 4 条 [BEHAVIOR]
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('≥ 4 条'))process.exit(1)"`

- [x] [ARTIFACT] generator SKILL v6.1 加 Step 6.5 Contract Self-Verification
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('Contract Self-Verification'))process.exit(1)"`

- [x] [ARTIFACT] 4 个 skill 全部 version bump
  Test: `manual:bash -c 'grep -E "^version: 7.4.0" packages/workflows/skills/harness-contract-proposer/SKILL.md && grep -E "^version: 8.2.0" packages/workflows/skills/harness-planner/SKILL.md && grep -E "^version: 6.2.0" packages/workflows/skills/harness-contract-reviewer/SKILL.md && grep -E "^version: 6.1.0" packages/workflows/skills/harness-generator/SKILL.md'`

- [x] [ARTIFACT] reviewer rubric threshold 升级到 7 维 ≥ 7
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('全部 7 维 ≥ 7'))process.exit(1)"`

- [x] [ARTIFACT] reviewer Step 4 verdict JSON 含 behavior_count_position 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(c.match(/behavior_count_position/g).length < 3)process.exit(1)"`

- [x] [ARTIFACT] Learning 文件含必备段
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0511074523-harness-skills-protocol-align.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] proposer Step 2b 模板含 ≥ 4 条 [BEHAVIOR] 示例
  Test: `manual:bash -c 'COUNT=$(grep -c "\\[BEHAVIOR\\]" packages/workflows/skills/harness-contract-proposer/SKILL.md); [ "$COUNT" -ge 4 ]'`

- [x] [BEHAVIOR] generator Step 6.5 含 grep BEHAVIOR Test manual: 提取逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('grep -E') || !c.includes('Test: manual:'))process.exit(1)"`

## 成功标准（runtime acceptance — PR 合并后由 W23 验）

- [ ] PR 创建 + CI 全绿
- [ ] PR merged 到 main
- [ ] 派 W23 验

## 不做

- 不改 evaluator SKILL
- 不改 brain runtime
- 不加机器化 CI lint（PR D 范围）
