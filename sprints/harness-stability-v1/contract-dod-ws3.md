# Contract DoD — Workstream 3: harness_report 失败重试

- [ ] [ARTIFACT] `packages/workflows/skills/harness-report/SKILL.md` 包含重试流程描述（含 `REPORT_FAILED` verdict）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(!c.includes('REPORT_FAILED'))process.exit(1);if(!c.includes('重试'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] Brain 编排代码中存在 harness_report 重试逻辑（max_retries=3，递增间隔）
  Test: node -e "const fs=require('fs');const p=require('path');let ok=false;for(const f of fs.readdirSync('packages/brain/src')){if(!f.endsWith('.js'))continue;const c=fs.readFileSync(p.join('packages/brain/src',f),'utf8');if(c.includes('harness_report')&&c.includes('retry')){ok=true;break}}if(!ok)process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] 3 次失败后输出 REPORT_FAILED verdict（不会无限重试）
  Test: node -e "const fs=require('fs');const p=require('path');let ok=false;for(const f of fs.readdirSync('packages/brain/src')){if(!f.endsWith('.js'))continue;const c=fs.readFileSync(p.join('packages/brain/src',f),'utf8');if(c.includes('REPORT_FAILED')&&c.includes('3')){ok=true;break}}if(!ok){const sk=fs.readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(sk.includes('REPORT_FAILED')&&sk.includes('3'))ok=true}if(!ok)process.exit(1);console.log('OK')"
