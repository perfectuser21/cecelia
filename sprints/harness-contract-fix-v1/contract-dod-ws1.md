# Contract DoD — Workstream 1: contract_branch 全链路透传

- [ ] [BEHAVIOR] harness-watcher.js CI通过→harness_report 的 payload 包含 contract_branch（值来自上游 payload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const s=c.split('harness_report')[1]||'';if(!s.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher.js CI失败→harness_fix 的 payload 包含 contract_branch（值来自上游 payload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const s=c.split('harness_fix')[1]||'';if(!s.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_fix→harness_report 的 payload 包含 contract_branch（值来自 harnessPayload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const b=c.substring(c.indexOf(\"harnessType === 'harness_fix'\"));const p=b.substring(0,b.indexOf('console.log'));if(!p.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
