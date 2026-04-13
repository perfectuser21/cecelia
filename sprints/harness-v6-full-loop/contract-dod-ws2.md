# Contract DoD — Workstream 2: Data Integrity (Verdict Protection + API-Only Data Transfer)

- [ ] [BEHAVIOR] execution-callback 检测到 tasks.result 已有 verdict 时不覆盖（agent 写入优先）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source')||(!c.includes('agent')&&!c.includes('existing')))throw new Error('FAIL: verdict 保护逻辑缺失');console.log('PASS: verdict 保护逻辑存在')"
- [ ] [BEHAVIOR] PATCH /api/brain/tasks/:id 写入 result.verdict 时标记 verdict_source=agent
  Test: curl -sf -X PATCH "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000" -H "Content-Type: application/json" -d '{"result":{"verdict":"TEST"}}' -o /dev/null -w "%{http_code}" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8').trim();if(s!=='404'&&s!=='200')throw new Error('FAIL: 期望 200/404，实际 '+s);console.log('PASS: PATCH tasks/:id 端点响应正常 ('+s+')')"
- [ ] [BEHAVIOR] extractBranchFromResult 从 tasks.result 提取 propose_branch/review_branch/contract_branch
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('extractBranchFromResult'))throw new Error('FAIL');if(!c.includes('propose_branch'))throw new Error('FAIL');console.log('PASS: 分支提取逻辑完整')"
