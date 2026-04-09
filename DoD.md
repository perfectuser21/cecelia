contract_branch: cp-harness-contract-e1a9f0ad
workstream_index: 1

# Contract DoD — Workstream 1: Reviewer + Planner SKILL.md 更新

- [x] [ARTIFACT] harness-contract-reviewer/SKILL.md REVISION 条件区块新增：Test 命令含 grep/ls/cat/sed/echo → 必须 REVISION
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');const revBlock=c.split('**REVISION 条件**')[1]?.split('###')[0]||'';if(!revBlock.includes('grep'))throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] Reviewer SKILL.md 的 APPROVED 条件区块明确列出白名单（node/npm/curl/bash/psql）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');const s=c.split('**APPROVED 条件**')[1]?.split('**REVISION 条件**')[0]||'';if(!s.includes('node')||!s.includes('psql'))throw new Error('FAIL');console.log('PASS')"
- [x] [ARTIFACT] harness-planner/SKILL.md 新增"预期受影响文件"PRD 模板小节
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('预期受影响文件'))throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] harness-planner/SKILL.md 有 bash 代码块含 ls/cat 读文件步骤
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const blocks=c.match(/\`\`\`bash[\s\S]*?\`\`\`/g)||[];if(!blocks.some(b=>b.includes('ls ')||b.includes('cat ')))throw new Error('FAIL');console.log('PASS')"
