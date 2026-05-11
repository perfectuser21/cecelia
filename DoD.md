# DoD — [CONFIG] proposer SKILL v7.5 死规则禁 PRD 字段名漂移 (Bug 8)

## ARTIFACT 条目

- [x] [ARTIFACT] proposer SKILL.md 含"死规则"段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('死规则（v7.5'))process.exit(1)"`

- [x] [ARTIFACT] proposer SKILL.md 含 "PRD 是法律，proposer 是翻译" 关键句
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('PRD 是法律，proposer 是翻译'))process.exit(1)"`

- [x] [ARTIFACT] proposer SKILL.md version 升级到 v7.5
  Test: `manual:bash -c 'grep -E "^version: 7.5.0" packages/workflows/skills/harness-contract-proposer/SKILL.md'`

- [x] [ARTIFACT] proposer SKILL.md 含自查 checklist
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('自查 checklist'))process.exit(1)"`

- [x] [ARTIFACT] Learning 文件含必备段
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0511133900-proposer-skill-prd-field-name-hard-rule.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] proposer SKILL.md 含字段名漂移反例表
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('negation')||!c.includes('quotient'))process.exit(1)"`

## 成功标准（runtime — W26 验）

- [ ] PR 创建 + CI 全绿
- [ ] PR merged 到 main
- [ ] 派 W26：proposer contract response key 字面是 PRD 给的 `result`/`operation`，不漂移

## 不做

- 不改其他 SKILL
- 不改 brain code
