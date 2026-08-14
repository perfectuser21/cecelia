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
