# Learning: AI 热点选题引擎 + 每日自动排期（2026-03-20）

## 新增 migration 后必须同步更新 selfcheck.js（2026-03-20）

### 根本原因

新增 migration 162（topic_selection_log 表）后，未同步更新 `packages/brain/src/selfcheck.js` 中的 `EXPECTED_SCHEMA_VERSION` 常量（仍为 `'161'`），导致 L2 Consistency Gate 中 `selfcheck_version_sync` 检查失败。同时 `DEFINITION.md` 中的 `Schema 版本` 字段也未更新，导致 `facts-check` 也失败。

### 下次预防

- [ ] 每次新增 migration 文件（`packages/brain/migrations/NNN_*.sql`）时，必须同步：(1) `packages/brain/src/selfcheck.js` → `EXPECTED_SCHEMA_VERSION` 改为新的 N，(2) `DEFINITION.md` → `schema_version` 行改为新的 N
- [ ] 在 Step 2 本地验证阶段加入 `node scripts/facts-check.mjs` 检查，确保在 push 前发现 schema 版本不同步问题
- [ ] DoD 的 [BEHAVIOR] Test 字段不能用 `npm run test`（CI 中 vitest 不在 PATH），必须用 `manual:node -e "require('fs').readFileSync(...)"` 检查源码内容

## DoD BEHAVIOR 测试命令格式（2026-03-20）

### 根本原因

DoD Verification Gate 在 L1 Process Gate 阶段运行时，CI 环境未安装 node_modules（无 `npm ci`），导致 `npm run test ... vitest` 报 `vitest: not found`（exit code 127）。这在 [BEHAVIOR] Test 字段使用 `manual:npm run test --workspace packages/brain -- --run ...` 时必然失败。

### 下次预防

- [ ] [BEHAVIOR] Test 字段改用 `manual:node -e "const c=require('fs').readFileSync('...','utf8');if(!c.includes('...'))throw new Error('...')"` 验证源码实现了预期行为
- [ ] 如需验证 vitest 测试文件存在且有正确用例，用 `node -e` 读取测试文件内容检查，不要调用 vitest 二进制
