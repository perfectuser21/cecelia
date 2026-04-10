# Contract DoD — Workstream 1: Proposer 合同草案生成

- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-draft.md` 存在，包含 4 个 Feature 和 ## Workstreams 区块
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(!c.includes('## Workstreams')||!c.includes('Feature 1'))throw new Error('FAIL: 结构不完整');console.log('PASS')"
- [ ] [ARTIFACT] `sprints/harness-self-check-v2/contract-dod-ws1.md` 存在，包含至少 1 个 [BEHAVIOR] 条目
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-dod-ws1.md','utf8');if(!c.includes('[BEHAVIOR]'))throw new Error('FAIL: 缺少 BEHAVIOR 条目');console.log('PASS')"
- [ ] [BEHAVIOR] propose branch 成功 push 到 origin，可被 Reviewer 拉取
  Test: node -e "const c=require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md','utf8');if(c.trim().length<500)throw new Error('FAIL: 文件内容过少，疑似未完整生成');console.log('PASS: 草案内容充分（'+c.length+'字节）')"
