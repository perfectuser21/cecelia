# RED evidence — validation clock fix-round deferral [r70]

## sprint 封印冻结测试 (base 未改实现)
 ❯ sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js  (10 tests | 7 failed) 10ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > r50 replay: 两条 generator-fix 后 deadline 顺延到最后一条 fix 原点（旧判死新存活）
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > bounded: 7 条 generator-fix 时 deadline 冻结在第 6 条 fix 原点（超限不再顺延）
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > exactly 6: 恰好 6 条 generator-fix 时第 6 条顺延生效
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > replay-order: 乱序 hop 传入按 hop 排序后取顺延原点
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > interleaved: 仅 generator-fix 计入顺延计数，非 fix 行不计
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > persisted-consistent: fix 原点 detail 自洽时复用 persistedClock
 FAIL  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js > resolveValidationClock — fix 轮顺延（有界） > persisted-inconsistent: fix 原点 detail 不自洽时 fail-closed 抛 validation_clock_invalid
 Test Files  1 failed (1)
      Tests  7 failed | 3 passed (10)

## gp 闸冻结测试 (base 未改实现)
 ❯ tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js  (3 tests | 2 failed) 5ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js > F1 step3 — validation clock 按 fix 轮自动顺延（有界） > r50 replay: 2 条 generator-fix 后 deadline 顺延到最后一条 fix 原点（旧判死新存活）
 FAIL  tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js > F1 step3 — validation clock 按 fix 轮自动顺延（有界） > bounded: 7 条 generator-fix 时 deadline 冻结在第 6 条 fix 原点（超限不再顺延）
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
