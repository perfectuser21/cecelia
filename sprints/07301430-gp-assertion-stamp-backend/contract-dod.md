# Contract DoD — Golden Path 断言盖章后端

- Decision: `df68e4fc-8428-4efb-9dd4-b4677dc06dee`
- Scope: 定版 PRD §④-1 后端真相层

## [BEHAVIOR] B-01：只有真实执行通过才能盖章

可运行断言必须由受信 runner 以 `shell:false` 执行；只有退出码为 0、具有
source SHA、机器标识和输出摘要的非 synthetic 执行才能写入 PASS receipt。
调用方不能直接提交 PASS。

Test: manual:bash `cd packages/brain && npx vitest run src/__tests__/gp-assertion-runner.test.js --reporter=verbose`

## [BEHAVIOR] B-02：receipt 不可篡改且版本失配自动失效

receipt 只追加，UPDATE/DELETE 被数据库拒绝；断言引用或格子归属变化会增加
revision，旧 receipt 保留审计但不再计入当前覆盖。

Test: manual:bash `cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-374-gp-assertion-receipts.integration.test.js --reporter=verbose`

## [BEHAVIOR] B-03：覆盖率只统计当前有效 PASS

业务状态为 green 但从未真实执行的格子返回 `never_run`；最近一次匹配执行
失败则当前不覆盖但保留历史 `last_verified`；decision/evaluation/N/A 不进入
可执行覆盖率分母。

Test: manual:bash `cd packages/brain && npx vitest run src/lib/__tests__/journey-assertion-receipt.test.js src/routes/__tests__/journey-steps-ledger.test.js --reporter=verbose`

## [BEHAVIOR] B-04：§③ 未就绪时 fail closed

受信 runner 在执行前检查 GP ledger readiness；锚点、NFR 或单实现收敛任一
未就绪，或检查数据库失败，都不得执行测试或写 receipt。

Test: manual:bash `cd packages/brain && npx vitest run src/__tests__/gp-assertion-runner.test.js --reporter=verbose`
