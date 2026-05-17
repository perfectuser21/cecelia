# DoD: H14 移除 account3 from ACCOUNTS

## 验收清单

- [x] [BEHAVIOR] account-usage.js ACCOUNTS 数组不含 'account3'
  Test: tests/brain/h14-remove-account3.test.js

- [x] [BEHAVIOR] credentials-health-scheduler.js CLAUDE_ACCOUNTS 数组不含 'account3'
  Test: tests/brain/h14-remove-account3.test.js

- [x] [BEHAVIOR] credential-expiry-checker.js ACCOUNTS 数组不含 'account3'
  Test: tests/brain/h14-remove-account3.test.js

- [x] [ARTIFACT] 3 src 文件不含 "'account3'" 字面量（仅 src/，不含 src/__tests__/）
  Test: manual:node -e "const fs=require('fs');const files=['packages/brain/src/account-usage.js','packages/brain/src/credentials-health-scheduler.js','packages/brain/src/credential-expiry-checker.js'];for(const f of files){const c=fs.readFileSync(f,'utf8');if(c.includes(\"'account3'\"))process.exit(1)}"

- [x] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h14-remove-account3.test.js')"

## Learning

文件: docs/learnings/cp-0510075509-h14-remove-account3.md

## 测试命令

```bash
npx vitest run tests/brain/h14-remove-account3.test.js
```
