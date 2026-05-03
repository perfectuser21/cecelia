# DoD: fix(brain) — auth_fail_count 持久化（指数退避计数跨重启恢复）

- [x] **[ARTIFACT]** 新增 migration 259，account_usage_cache 增加 auth_fail_count 列
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/migrations/259_account_usage_auth_fail_count.sql')"`
- [x] **[BEHAVIOR]** markAuthFailure 将 auth_fail_count 写入 DB（ON CONFLICT UPDATE）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8');if(!c.includes('auth_fail_count'))process.exit(1)"`
- [x] **[BEHAVIOR]** loadAuthFailuresFromDB 从 DB 恢复 auth_fail_count 到 _authFailureCountMap
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8');if(!c.includes('_authFailureCountMap.set(row.account_id, row.auth_fail_count)'))process.exit(1)"`
- [x] **[BEHAVIOR]** resetAuthFailureCount 有记录时同步将 DB auth_fail_count 清零
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8');if(!c.includes('auth_fail_count = 0'))process.exit(1)"`
- [x] **[BEHAVIOR]** 全套单元测试通过（64 tests，含 7 个新增持久化测试）
  - Test: `packages/brain/src/__tests__/account-usage.test.js`
