---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 迁移扩 failure_class 纳入 account_exhausted + 代码↔schema 奇偶回归测试

**范围**: 新增代码↔schema 奇偶回归测试（唯一净新增）；迁移 406 / 既有 integration+class 测试 / selfcheck 版本同步作为回归 oracle 保留。不改 `execution-contract.js` / `derive.js` 业务逻辑（PRD 边界）。
**大小**: S

## 历史约束 Invariant 覆盖（铁律映射）

- INV-约束只追加不放开 → 由 **B-03**（未知脏值仍抛 23514）执法
- INV-不改业务逻辑（PRD 边界）→ 由第 3 条 **ARTIFACT**（diff 不触 execution-contract.js / derive.js）执法
- N/A 说明：controller 未注入额外铁律清单；以上为 PRD 边界自映射，不单列 BEHAVIOR 条目（其断言已由 B-03 与 ARTIFACT 承担）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 奇偶回归测试文件存在且**从 zod schema 动态读取**枚举（非硬编码复制清单）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js','utf8');if(!/execution-contract/.test(c)||!/harnessResultSchema|failure_class/.test(c)){process.exit(1)}"
  期望: exit 0（文件存在且 import execution-contract zod schema）

- [ ] [ARTIFACT] 迁移 406 保留 4 旧值 + 新增 account_exhausted（幂等 DROP IF EXISTS + ADD）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/406_harness_attempt_account_exhausted.sql','utf8');if(!/DROP CONSTRAINT IF EXISTS harness_attempts_failure_class_check/i.test(c)||!/'account_exhausted'/.test(c)||!/'needs_context'/.test(c)){process.exit(1)}"
  期望: exit 0

- [ ] [ARTIFACT] PRD 边界：未改动 execution-contract.js / derive.js 业务逻辑（本 sprint 只应新增测试）
  Test: node -e "const {execSync}=require('child_process');const d=execSync('git diff --name-only origin/main...HEAD || git diff --name-only HEAD~1 2>/dev/null || true',{encoding:'utf8'});if(/orchestrator\/(execution-contract|derive)\.js/.test(d)){console.error('FAIL: 改动了受保护业务逻辑文件');process.exit(1)}console.log('OK')"
  期望: OK（此为软核对，Reviewer 以 diff 实际为准）

## BEHAVIOR 条目（内嵌可执行 manual: 命令，五行剧本）

- [ ] [BEHAVIOR] [L2] B-01: 迁移后 account_exhausted 写库被 DB 约束接受（迁移前 23514 复现 / 迁移后绿 / 幂等）
  动作: 在 attempt 级 *_test 空库上运行 migration-406 integration 套件（自举隔离 schema，应用迁移链 357→366→378→406）
  预期观察: 全部用例 PASS —— 迁移前 UPDATE account_exhausted 抛 23514、迁移后接受并读回、连跑 2 次幂等且 schema_version '406' 仅 1 行
  等待预算: 90s（PG 连接 + schema 自举；超时=FAIL）
  留证: vitest --reporter=verbose 输出末 20 行进 evidence
  Test: manual:bash -c 'cd packages/brain && export TEST_DATABASE_URL="${DB_URL:?}" DATABASE_URL="${DB_URL:?}" && npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-406-account-exhausted.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 代码↔schema 奇偶 —— zod failure_class 枚举全集逐值被 DB 约束接受（净新增守卫）
  动作: 运行奇偶 integration 测试，它从 execution-contract.js zod schema 动态读枚举全集，迁移 406 后对每值 UPDATE harness_attempts.failure_class
  预期观察: 读到枚举 ≥5 值，逐值 UPDATE 全部成功（0 个 23514）；zod 与 DB 约束不脱钩则全绿
  等待预算: 90s（PG 连接 + schema 自举；超时=FAIL）
  留证: vitest 输出（含读到的枚举值列表）进 evidence
  Test: manual:bash -c 'cd packages/brain && export TEST_DATABASE_URL="${DB_URL:?}" DATABASE_URL="${DB_URL:?}" && npx vitest run --config vitest.integration.config.js src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 约束只追加不放开 —— 未知脏值仍被拒（23514）
  动作: 运行奇偶测试中的负向断言（对不在 zod 枚举内的脏值 UPDATE）
  预期观察: 脏值 UPDATE 抛 SQLSTATE 23514，负向用例 PASS
  等待预算: 90s（超时=FAIL）
  留证: vitest -t 过滤输出进 evidence
  Test: manual:bash -c 'cd packages/brain && export TEST_DATABASE_URL="${DB_URL:?}" DATABASE_URL="${DB_URL:?}" && npx vitest run --config vitest.integration.config.js src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js -t "rejects" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: selfcheck EXPECTED_SCHEMA_VERSION 与最大迁移号同步
  动作: 读 src/selfcheck.js 的 EXPECTED_SCHEMA_VERSION 与 migrations/ 下最大迁移号比较
  预期观察: EXPECTED_SCHEMA_VERSION(int) >= 最大迁移号(int)（当前两者均为 406）
  等待预算: 0s（同步）
  留证: node stdout "OK selfcheck exp=... max=..."
  Test: manual:bash -c 'cd packages/brain && node -e "import(\"./src/selfcheck.js\").then(async m=>{const fs=await import(\"node:fs\");const nums=fs.readdirSync(\"migrations\").map(f=>{const x=f.match(/^(\d+)_/);return x?parseInt(x[1],10):0}).filter(Boolean);const max=Math.max.apply(null,nums);const exp=parseInt(m.EXPECTED_SCHEMA_VERSION,10);if(exp<max){console.error(\"FAIL exp=\"+exp+\" max=\"+max);process.exit(1)}console.log(\"OK selfcheck exp=\"+exp+\" max=\"+max)})"'

- [ ] [BEHAVIOR] [L1] B-05: 迁移文本静态不变量 —— 保留 4 旧值且新增 account_exhausted 且 VALUES ('406'
  动作: 运行既有 class 单测（无需 PG，brain-unit 层）
  预期观察: class 测试 PASS（迁移文本含全部 5 值 + '406' 版本行）
  等待预算: 30s（超时=FAIL）
  留证: vitest 输出进 evidence
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/migration-406-account-exhausted-class.test.js --reporter=verbose'
