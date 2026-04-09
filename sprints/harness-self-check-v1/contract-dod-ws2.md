# Contract DoD — Workstream 2: contract-dod 路径三处统一

- [ ] [ARTIFACT] harness-contract-proposer/SKILL.md 中 contract-dod-ws 写入路径包含 ${SPRINT_DIR}/ 前缀
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(c.includes('cat > \"contract-dod-ws'))throw new Error('FAIL: 仍用根目录');console.log('PASS')"
- [ ] [ARTIFACT] harness-generator/SKILL.md 中 contract-dod-ws 读取路径包含 ${SPRINT_DIR}/
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');const lines=c.split('\n').filter(l=>l.includes('contract-dod-ws'));if(lines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] ci.yml harness-dod-integrity job 从 SPRINT_DIR/contract-dod-ws 读取合同 DoD
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const lines=c.split('\n').filter(l=>l.includes('contract-dod-ws'));if(lines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
- [ ] [ARTIFACT] Proposer git add 行也使用 ${SPRINT_DIR}/contract-dod-ws* 路径
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');const addLines=c.split('\n').filter(l=>l.includes('git add')&&l.includes('contract-dod'));if(addLines.some(l=>!l.includes('SPRINT_DIR')))throw new Error('FAIL');console.log('PASS')"
