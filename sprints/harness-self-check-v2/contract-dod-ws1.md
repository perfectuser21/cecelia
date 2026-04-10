# Contract DoD — Workstream 1: Proposer 合同草案生成行为

- [x] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在且含 >= 4 个 Feature 标题
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const n=(c.match(/^## Feature \d+/gm)||[]).length;if(n<4)throw new Error('FAIL:Feature数='+n);console.log('PASS:'+n+'个Feature')"
- [x] [BEHAVIOR] Proposer 输出的草案包含 >= 8 个 bash 命令块，且每个 contract-dod-ws 文件含 [BEHAVIOR] 条目
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const b=(c.match(/^\`\`\`bash/gm)||[]).length;if(b<8)throw new Error('FAIL:bash块='+b);const dods=fs.readdirSync('sprints/harness-self-check-v2').filter(f=>f.startsWith('contract-dod-ws'));dods.forEach(f=>{const d=fs.readFileSync('sprints/harness-self-check-v2/'+f,'utf8');if(!(d.match(/\[BEHAVIOR\]/g)||[]).length)throw new Error('FAIL:'+f+'无BEHAVIOR');});console.log('PASS:bash='+b+'，DoD文件='+dods.length)"
