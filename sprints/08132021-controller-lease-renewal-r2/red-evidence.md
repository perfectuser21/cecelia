# Red 证据 — sprint 08132021-controller-lease-renewal-r2

TDD Red 阶段：实现（buildKernelLaunchArgs / parseArgs controllerSessionId /
writeHeartbeat 续租 CAS）尚未落地时，合同测试全红。

## RED-4 纯装配（controller-session-passthrough.test.js，无 DB，本机实跑）

对 impl 前代码运行 `npx vitest run src/__tests__/controller-session-passthrough.test.js`：

```
 × parseArgs 解析 --controller-session-id 作为 Kernel 续租身份
 × buildKernelLaunchArgs 把创建时 controllerSessionId 透传给 detached child（不止 run_id）
   → buildKernelLaunchArgs is not a function
 × buildKernelLaunchArgs 透传 resumeToken（存在时）且不注入伪 session
   → buildKernelLaunchArgs is not a function
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

## RED-1/1b/2/3/3b 真 PG（kernel-controller-lease-renewal.pg.integration.test.js）

需真 PostgreSQL（本 fleet-worker 无本地 PG server 二进制，改由 CI brain-integration
job 起真 PG 常驻跑）。impl 前 writeHeartbeat 无 controllerSessionId 入参、不写
controller_lease_expires_at、不返回 rowCount → RED-1/1b/2/3/3b 全部断言 FAIL。
Green 后 writeHeartbeat 续租 CAS + GREATEST 使其转绿。

## Generator-fix 机械门禁 RED（冻结 SHA 93a1c50f，2026-08-14）

在拆分前新增并执行永久回归：

```text
npx vitest run src/__tests__/kernel-controller-lease-renewal-file-size.test.js --reporter=verbose
× kernel-controller-lease-renewal.pg.integration.test.js 超过 500 行: actual=669
× kernel-controller-lease-renewal.pg-fixture.js 必须存在
× migration-416-controller-session-nonblank.pg.integration.test.js 必须存在
Tests 3 failed | 6 passed (9)
```

该 RED 只针对本 sprint 新增/拆出的 JavaScript 测试与真 PG helper；两份冻结测试未修改。拆分完成后同一门禁必须 9/9 GREEN。

## Generator-fix6 真 PG RED（起点 f2526d838e，2026-08-14）

Evaluator 第 7 轮的四个 P1 finding 已在既有永久真 PostgreSQL 测试资产中复现；
生产实现尚未修改。

```text
NODE_ENV=test npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js \
  -t 'TASK-TERMINAL-' --reporter=verbose

× TASK-TERMINAL-CANCELLED: cancelled parent task 的 active run 心跳必须零推进
  → expected rowCount 0, received 1
× TASK-TERMINAL-COMPLETED: completed parent task 的 active run 心跳必须零推进
  → expected rowCount 0, received 1
Tests 2 failed | 11 skipped (13)
```

```text
NODE_ENV=test npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/migration-416-controller-session-nonblank.pg.integration.test.js \
  --reporter=verbose

× MIGRATION-C: TAB/NBSP/ideographic space 历史行未全部归一为 NULL
  → normalized.every(session === null): expected true, received false
× NEW-WRITE-C: 数据库仍接受 TAB/NBSP/ideographic space 新写入
  → error codes: ['23514', '23514', null, null, null]
× BLANK-C: 纯空白参数与同值历史行仍可 heartbeat 续命
  → rowCounts: [0, 0, 1, 1, 1]
Tests 3 failed (3)
```

对照检查 JS 创建校验以 TAB/NBSP/ideographic space 运行通过；初始 RED 根因是 PostgreSQL
`BTRIM` 未覆盖 POSIX whitespace，以及 heartbeat UPDATE 未绑定父 task 终态。后续 CI 在 C locale
暴露裸 `[[:space:]]` 对 NBSP/ideographic space 的 locale 漂移；永久 fixture 固定 UTF-8/C 后，旧实现
稳定得到 `MIGRATION-C/NEW-WRITE-C/BLANK-C` 3 FAIL 与 heartbeat `[0,0,0,1,1]`。该追加 RED commit
为 `264193761e`，要求 POSIX 类加完整 Unicode whitespace/FEFF 后在不同 locale 保持同一 oracle。
