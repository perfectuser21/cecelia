# Contract DoD — Workstream 1: Proposer 合同生成验证

- [ ] [ARTIFACT] contract-draft.md 存在于 sprint_dir 且包含所有 PRD 功能点对应的 Feature 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(!c.includes('## Feature 1')||!c.includes('## Feature 2')||!c.includes('## Feature 3')||!c.includes('## Feature 4'))throw new Error('FAIL: 缺少 Feature 区块');console.log('PASS: 4 个 Feature 区块全部存在')"
- [ ] [BEHAVIOR] 合同中每个 Feature 包含可执行的 bash 验证命令（非占位符），且合同包含 Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');const cmdBlocks=(c.match(/```bash/g)||[]).length;if(cmdBlocks<4)throw new Error('FAIL: bash 代码块不足 4 个，实际 '+cmdBlocks);if(!c.includes('workstream_count:'))throw new Error('FAIL: 缺少 workstream_count');console.log('PASS: '+cmdBlocks+' 个 bash 代码块 + workstream_count 存在')"
- [ ] [ARTIFACT] 每个 workstream 的 contract-dod-ws{N}.md 文件存在且含 [BEHAVIOR] + Test 字段
  Test: node -e "const fs=require('fs');for(let i=1;i<=3;i++){const f='sprints/harness-self-check-v2/contract-dod-ws'+i+'.md';const c=fs.readFileSync(f,'utf8');if(!c.includes('[BEHAVIOR]'))throw new Error('FAIL: '+f+' 缺少 [BEHAVIOR]');if(!c.includes('Test:'))throw new Error('FAIL: '+f+' 缺少 Test')}console.log('PASS: 3 个 DoD 文件结构正确')"
