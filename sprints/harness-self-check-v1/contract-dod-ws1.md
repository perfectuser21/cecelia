# Contract DoD — Workstream 1: Reviewer + Planner SKILL.md 更新

- [ ] [ARTIFACT] harness-contract-reviewer/SKILL.md REVISION 条件新增一条：Test 命令含 grep/ls/cat/sed/echo → 必须 REVISION
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('grep'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Reviewer SKILL.md 的 APPROVED 条件明确列出允许工具白名单（node/npm/curl/bash/psql）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');const s=c.split('APPROVED 条件')[1]||'';if(!s.includes('node')||!s.includes('psql'))throw new Error('FAIL');console.log('PASS')"
- [ ] [ARTIFACT] harness-planner/SKILL.md 新增"预期受影响文件"PRD 模板小节
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('预期受影响文件'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] harness-planner/SKILL.md 在写 PRD 前有读取文件的步骤
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('ls')||!c.includes('cat'))throw new Error('FAIL');console.log('PASS')"
