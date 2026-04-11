# DoD: fix-contract-branch-recovery

## 成功标准

- [x] [ARTIFACT] execution.js 中存在 `cp-harness-review-approved-` fallback 逻辑（git ls-remote 检查）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('cp-harness-review-approved-'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] execution.js 中 P0 guard 不再直接 return，而是先尝试 fallback
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('cp-harness-review-approved-');if(idx===-1)process.exit(1);const before=c.substring(0,idx);if(!before.includes('contractBranch'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 新增测试文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-contract-branch-recovery.test.ts');console.log('OK')"

- [x] [BEHAVIOR] 测试：contractBranch=null 且 git ls-remote 找到分支 → fallback 成功，extractContractBranchFallback 返回分支名
  Test: tests/packages/brain/src/__tests__/harness-contract-branch-recovery.test.ts

- [x] [BEHAVIOR] 测试：contractBranch=null 且 git ls-remote 找不到分支 → 返回 null（终止）
  Test: tests/packages/brain/src/__tests__/harness-contract-branch-recovery.test.ts
