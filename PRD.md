## 成功标准

- [x] [BEHAVIOR] SKILL.md 含"位置词死规则"关键字
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('位置词死规则'))process.exit(1)"
- [x] [ARTIFACT] SKILL.md 版本升至 8.4.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('8.4.0'))process.exit(1)"
