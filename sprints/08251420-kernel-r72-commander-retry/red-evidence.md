# RED 证据 — commander lease 过期有界重派 [r72]

冻结测试真 import `packages/brain/src/orchestrator/derive.js`，在**未修**代码上运行，
3 条修复驱动用例 RED（现状 derive 对单条 commander infrastructure 收割即返回
`wait:human_review(callback_infrastructure_route_unknown)`），4 条守卫/隔离用例已 GREEN。

```
$ npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js --no-cache

 FAIL  commander infra 单次过期 → 主链续跑不挂人审（根因修复）
   AssertionError: expected 'wait:human_review' not to be 'wait:human_review'
 FAIL  commander infra 过期对主链透明 → action 等于无回调基线
   AssertionError: expected 'wait:human_review' to be 'spawn:judge'
 FAIL  commander infra 上限内4次仍续跑不挂人审
   AssertionError: expected 'wait:human_review' not to be 'wait:human_review'
 ✓ commander infra 累计达上限5 → fail-closed 回落人审带 hop 锚
 ✓ 角色隔离：planner infra 过期语义不变（重派 spawn:planner）
 ✓ 失败类隔离：commander account_exhausted 语义不变（仍 route_unknown）
 ✓ 纯函数可重放：同输入同输出（禁引入新状态存储）

 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```

## 修后（proposer 侧已本地验证，供 generator 参照，非合同承诺实现）

在 `attemptCallbackRoute` 的 `infrastructure_blocked` 分支内为 `role==='commander'` 加降级续跑
（低于 `COMMANDER_INFRA_RETRY_CAP=5` 返回非阻塞让主链续跑，达上限 fail-closed 回落人审带 callbackHop 锚）
后，本文件 7 条全绿；同时 `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js` 需迁移为
交替 `spawn/expired ×5` 的达上限形状，迁移后 #5058 消费锚回归 5 条全绿（新语义下保留覆盖）。
非 commander 角色与非 infrastructure 失败类分支逐字不变（`packages/brain/src/orchestrator/__tests__/derive.test.js` 无回归）。
