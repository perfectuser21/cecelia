# Red 证据 — validation clock 按 fix 轮自动顺延（有界）[r55]

冻结合同测试对当前（永远锚定首个 generator）实现执行：

```
$ npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js
Tests  3 failed | 2 passed (5)
```

- 3 failed（对当前实现 RED，符合预期）：
  - `两轮 fix 后时钟顺延至最新 generator-fix 存活`——当前锚定首 generator（T0），deadline 未顺延到 fix#2（T0+2h）。
  - `顺延重新起算：忽略 fix 行陈旧 persisted 时钟以其 spawn 时刻为新原点`——当前返回首窗 deadline，未以最新 fix 行 spawn 时刻重算。
  - `顺延有界：超过 6 次上限后锚定第 6 次 fix 不再前移`——当前锚定首 generator（T0），未锚定第 6 轮 fix（T0+6h）。
- 2 passed（不变量/可重放守卫，RED/GREEN 均绿）：
  - `无 fix 轮时窗口语义不变仍锚定首个 generator`。
  - `纯函数可重放：同一 decisionLog 两次调用结果一致`。

符合合同 Test Contract 预期红证据「5 tests → 3 failed | 2 passed」。
真 import `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`，无 vi.mock（禁 mock 被改的边）。
