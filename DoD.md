# DoD: 合并审查 Skill 为 4 个 Codex Gate

- [ ] F1: packages/workflows/skills/prd-review/SKILL.md 存在且包含 verdict/score/findings 输出格式
  - test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/prd-review/SKILL.md','utf8');if(!c.includes('verdict') || !c.includes('score') || !c.includes('findings'))process.exit(1)"
- [ ] F2: packages/workflows/skills/spec-review/SKILL.md 存在且包含 PASS/FAIL verdict
  - test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/spec-review/SKILL.md','utf8');if(!c.includes('PASS') || !c.includes('FAIL'))process.exit(1)"
- [ ] F3: packages/workflows/skills/code-review-gate/SKILL.md 存在且包含 blocker/warning/info severity
  - test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/code-review-gate/SKILL.md','utf8');if(!c.includes('blocker') || !c.includes('warning') || !c.includes('info'))process.exit(1)"
- [ ] F4: packages/workflows/skills/initiative-review/SKILL.md 存在且包含 Phase 1 和 Phase 2
  - test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/initiative-review/SKILL.md','utf8');if(!c.includes('Phase 1') || !c.includes('Phase 2'))process.exit(1)"
