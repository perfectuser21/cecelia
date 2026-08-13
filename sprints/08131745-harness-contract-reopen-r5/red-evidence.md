# RED 证据 — Harness 合同重开后原子换版（r5）

## 本地环境限制
Fleet worker 仅装了 postgresql-client（psql），无 postgres server / initdb 二进制，
且未注入 DATABASE_URL/DB，故 `describe.runIf(HAS_REAL_POSTGRES)` 真 PG 块本地被 skip。
真 RED→GREEN 由 CI `brain-integration` job（pgvector/pgvector:pg15 服务）执行，
该 job 显式点名 `src/orchestrator/__tests__/contract-store.test.js`（ci.yml:830）。

## 本地可验证的部分（无 DB）
$ npx vitest run src/orchestrator/__tests__/contract-store.test.js --reporter=verbose
 Test Files  1 passed (1)
      Tests  2 passed | 7 skipped (9)
- 2 passed = 纯 mock 并发契约块（无 DB 依赖）
- 7 skipped = 3 既有真 PG 用例 + 4 本刀新增 reopen 换版用例（DB 门控，本地 skip）
- 文件解析/收集通过，无语法错误

## RED 断言（修复前，真 PG 下必红）
用例 1 `reopen v1 draft attached + Round2 新证据 → 原子换版 v2`：
  run.contract_id 指向 v1 draft 时，修复前 materializeApprovedContract 走「已附着合同」
  证据比对分支，把 draft 附件当同轮批准证据，逐字段比对失败抛
  `attached approved contract evidence mismatch` → 用例 FAIL（复现生产 run 88a78d20 死锁）。

## GREEN 断言（修复后）
附着合同 status='draft' 时不做逐字段比对，落到插入路径原子换版：
  插 v2 approved + 置 v1 superseded + run.contract_id 切 v2；
  status='approved' 时保持逐字段比对 + fail-closed。

 RUN  v1.6.1 /workspace/packages/brain

 ✓ src/orchestrator/__tests__/contract-store.test.js > materializeApprovedContract concurrency contract > Pool 路径在独立事务中先锁逻辑 contract，再用新语句 snapshot 物化
 ✓ src/orchestrator/__tests__/contract-store.test.js > materializeApprovedContract concurrency contract > writer-first manifest 冲突回滚后返回稳定 assembly fault，而非 SQL 除零错误

 Test Files  1 passed (1)
      Tests  2 passed | 7 skipped (9)
   Start at  10:07:58
   Duration  268ms (transform 34ms, setup 0ms, collect 72ms, tests 3ms, environment 0ms, prepare 50ms)

