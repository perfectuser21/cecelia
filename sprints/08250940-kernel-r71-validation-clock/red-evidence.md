# Red Evidence — validation clock 未按 fix 轮顺延时冻结测试全红 [r71]

冻结测试真 import `packages/brain/src/orchestrator/validation-clock.js`（未 mock 被改的边）。
当前实现 `resolveValidationClock` 原点取「最早 generator」，多 fix 轮长跑 run 撞死固定 deadline。
新行为断言（原点顺延到最后一次 fix、有界 6 次）在当前实现下必红；无 fix 轮的回归断言保持绿。

## sprint 冻结合同测试（seal gate 认这一份）

```
=== RED: sprint frozen test against current (unpatched) impl ===
- Expected
+ Received

  Object {
-   "deadline_at": "2026-08-25T07:30:00.000Z",
-   "pipeline_started_at": "2026-08-25T06:00:00.000Z",
+   "deadline_at": "2026-08-25T01:30:00.000Z",
+   "pipeline_started_at": "2026-08-25T00:00:00.000Z",
  }

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

- 2 failed = 新行为（顺延存活 / 有界判死）在旧实现下必红。
- 1 passed = 回归断言（无 fix 轮语义不变，原点=首个 generator）当前已绿，实现后仍须绿。

## F1 gp/f1 冻结测试（gp-anchor 闸认这一份）

```
=== RED: tests/gp/f1/step3-validation-clock-fix-round-extend.test.js against current impl ===
⎯ Failed Tests 6 ⎯
 FAIL ... > RED先行 复刻 r50 场景 起点5400s前多次fix 新实现顺延存活
 FAIL ... > 新派发 spawn:generator-fix 也以最后一次fix为新原点顺延
 FAIL ... > spawn:judge 下游复用同一顺延后原点
 FAIL ... > 有界 顺延满6次后照常判死 第7次fix不再顺延原点冻结第6次
 FAIL ... > 边界 恰好第6次fix仍顺延原点取第6次
 FAIL ... > 纯函数可重放 fix行乱序重复hop以hop升序取最后合法fix
 Test Files  1 failed (1)
      Tests  6 failed | 2 passed (8)
```

- 6 failed = 新行为断言全红。
- 2 passed = 回归断言（无 fix 轮 / pre-fix in-flight 恢复）保持绿。

## GREEN 可达性（起草者本地验证，实现属 generator 职责）

参考实现（`resolveValidationClock` 在 VALIDATION_ACTIONS 闸后插入：filter `spawn:generator-fix` 行按 hop 升序，
取 `min(count,6)` 号 fix 行 `created_at` 作 `exactClock` 原点）验证：
- gp/f1 8 条全绿 + sprint 3 条全绿；
- 既有 `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` 11 条**全绿不回归**（无 fix 轮语义不变）。

合同目标可达且精确；实现禁改 `timeout_seconds` 默认值、禁动人审 deadline 分支。
