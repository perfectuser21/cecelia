# RED 证据 — validation clock 按 fix 轮有界顺延 [r57]

冻结守卫：`sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js`
真 import real `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`（禁 mock 被改的边）。

## 修前（RED，现行为永远锚死首 generator 原点）

```
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js
...
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

失败 3 条（复现 bug —— 现行为不随 fix 轮顺延）：
- `2 轮 generator-fix 后 deadline 顺延到最新 fix 原点…`：期望 `2026-08-01T02:46:40Z`（fix2.created_at + timeout），实得 `2026-08-01T01:30:00Z`（首原点 + timeout）
- `顺延超上限：7 轮 generator-fix deadline 冻结在第 6 次顺延原点…`：期望第 6 次 fix 原点，实得首原点
- `边界：恰好 6 轮 generator-fix 仍顺延到第 6 次原点…`：期望第 6 次 fix 原点，实得首原点

通过 2 条（回归守恒，修前修后都应绿）：
- `无 generator-fix 行时窗口仍以首 generator 原点算（回归守恒，语义不变）`
- `fail-closed 守恒：非 generator 系且无有效 origin 仍抛 validation_clock_required`

## 修后（GREEN，参考实现本地实证）

参考实现：`resolveValidationClock` 统计 decisionLog 中 `spawn:generator-fix` 行数
`boundedExtensions=min(fixCount, VALIDATION_CLOCK_EXTENSION_LIMIT=6)`；`===0` 走既有
`persistedClock(首原点)`；`>=1` 时 `exactClock(第 boundedExtensions 个 fix 行.created_at, timeout)`。

```
# 冻结守卫（仓库根跑，sprints/** 在根 vitest include）
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js
      Tests  5 passed (5)

# 既有回归（子 shell 用 packages/brain vitest 配置）
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js )
      Tests  11 passed (11)
```

冻结守卫 5/5 全绿 + 既有 11/11 零回退。
