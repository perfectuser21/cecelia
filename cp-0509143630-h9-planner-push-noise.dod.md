# DoD: H9 harness-planner SKILL push noise 静默

## 验收清单

- [ ] [BEHAVIOR] SKILL Step 3 git push 失败时整体 exit=0 且 stdout 含 fallback
  Test: tests/skills/harness-planner-push-noise.test.js

- [ ] [BEHAVIOR] SKILL Step 3 git push 成功时不打 fallback echo（无噪音）
  Test: tests/skills/harness-planner-push-noise.test.js

- [ ] [ARTIFACT] SKILL.md:151 含 2>/dev/null + || echo + push skipped
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/git push origin HEAD 2>\/dev\/null \|\| echo.*push skipped/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/skills/harness-planner-push-noise.test.js')"

## Learning

文件: docs/learnings/cp-0509143630-h9-planner-push-noise.md

## 测试命令

```bash
npx vitest run tests/skills/harness-planner-push-noise.test.js
```
