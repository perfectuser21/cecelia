---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel validation clock 按 fix 轮自动顺延（有界）[r55]

**范围**: `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 原点选点逻辑——存在 `spawn:generator-fix` 时以最新 generator 系 spawn 的 `created_at` 为新原点重算窗口（顺延），顺延有界（每 run ≤6 次），超上限锚定第 6 轮不前移；无 fix 轮语义不变；fail-closed / evaluator-origin / malformed 三既有语义不回退。
**大小**: S

> 验证等级说明：本 sprint DoD BEHAVIOR 均为 **[L2]**——真 import 被改模块 `validation-clock.js` 真执行 `resolveValidationClock`（**无替身、无 vi.mock**，非 L1 替身层），以真实构造的 orchestrator_decision_log 行数组逐字锁定顺延语义；本 attempt postgres=false 故无真库（L3 真机/真库集成见 contract-draft「未覆盖真实链路清单」）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结 sprint 测试文件存在且真 import validation-clock.js（无 vi.mock）
  Test: node -e "const c=require('fs').readFileSync('sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js','utf8');if(!c.includes(\"orchestrator/validation-clock.js\")||c.includes('vi.mock'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] validation-clock.js 顺延逻辑落地（含顺延上限 6 常量 + generator-fix 选点）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!c.includes('spawn:generator-fix')||!/6/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous / local_api）

- [ ] [BEHAVIOR] [L2] B-01: 两轮 fix 后时钟顺延至最新 generator-fix，长跑 run 存活（r50 复刻）
  动作: 构造首 generator(T0)+fix#1(T0+1h)+fix#2(T0+2h) 的 decisionLog，调 resolveValidationClock(action=spawn:judge, timeout=5400) 断言返回时钟
  预期观察: pipeline_started_at==T0+2h 且 deadline_at==T0+2h+5400s（顺延到最新 fix），且 != T0+5400s（旧窗口甩开）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js -t "两轮 fix 后时钟顺延至最新 generator-fix 存活" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-02: 顺延重新起算——忽略 fix 行陈旧 persisted 时钟以其 spawn 时刻为新原点（防假绿）
  动作: 令最新 fix 行 detail 携带陈旧首窗 {pipeline_started_at:T0, deadline_at:T0+5400s} 但 created_at=T0+2h，调 resolveValidationClock 断言
  预期观察: deadline_at==T0+2h+5400s（以 spawn 时刻重算），!= T0+5400s（不回落陈旧首窗）——「选新行仍读旧 persisted」被判红
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js -t "顺延重新起算" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] INV-3 B-03: 顺延有界——超过 6 次上限锚定第 6 次 fix 不前移（负向防无限续命）
  动作: 构造 7 轮 fix（fix#i created_at=T0+i·1h）的 decisionLog，调 resolveValidationClock 断言返回时钟
  预期观察: pipeline_started_at==T0+6h 且 deadline_at==T0+6h+5400s（封顶第 6 轮），!= T0+7h+5400s（不顺延到第 7 轮，到期照常判死）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js -t "超过 6 次上限后锚定第 6 次 fix 不再前移" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] INV-1 B-04: 无 fix 轮时窗口语义不变仍锚定首个 generator（不变量）
  动作: 构造只有首 spawn:generator（携带 persisted 首窗时钟）的 decisionLog，调 resolveValidationClock 断言
  预期观察: 返回首 generator 的 persisted clock（{pipeline_started_at:T0, deadline_at:T0+5400s}），语义与本 sprint 前一致
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js -t "无 fix 轮时窗口语义不变" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] INV-4 B-05: 纯函数可重放——同一 decisionLog 两次调用结果一致（禁 Date.now 外墙钟）
  动作: 同一 3 轮 fix 的 decisionLog、不同 intentAt 两次调用 resolveValidationClock，断言两次返回逐字相等
  预期观察: 两次返回时钟对象 toEqual（deep 相等），顺延判定只依赖 decisionLog 行 hop 时序
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js -t "纯函数可重放" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] INV-2 B-06: repo 既有 validation-clock 单测全绿（fail-closed / evaluator-origin / malformed 语义不回退）
  动作: 在 packages/brain 包内跑 repo 既有 validation-clock 单测（含下游无 clock throw required / verified-existing-PR evaluator origin / persisted malformed throw invalid / authoring 返 null）
  预期观察: 全部既有 it() 绿（0 failed），fail-closed 系语义与本 sprint 前完全一致
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js 2>&1 | grep -qE "[1-9][0-9]* passed"'
