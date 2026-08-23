---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: validation clock 按 fix 轮有界顺延（长跑 run 不再被固定窗口误杀）[r57]

**范围**: `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` —— 把「永远锚定首个 generator 原点」改为「按 `spawn:generator-fix` 行数有界顺延到最新 generator 系 spawn 行 created_at 重算 timeout_seconds、上限 6 次」的纯函数逻辑。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 本 sprint 冻结守卫存在且真 import real validation-clock.js，断言有界顺延语义
  Test: node -e "const c=require('fs').readFileSync('sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js','utf8');if(!c.includes(\"from '../../../packages/brain/src/orchestrator/validation-clock.js'\")||!c.includes('deadline 顺延到最新 fix 原点'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] validation-clock.js 硬编码顺延上限常量 VALIDATION_CLOCK_EXTENSION_LIMIT = 6（有界续命铁律）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/VALIDATION_CLOCK_EXTENSION_LIMIT\s*=\s*6\b/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，vitest 冻结守卫；带 -t 过滤统一用 grep -qE "[1-9][0-9]* passed" 宽松式）

- [ ] [BEHAVIOR] [L2] B-01: 2 轮 generator-fix 后 deadline 顺延到最新 fix 原点 created_at + timeout（RED→GREEN 核心）
  动作: 构造 decisionLog（首 generator + 2 行 spawn:generator-fix，最新 fix 携 stale persisted detail 锚在首原点），调 real resolveValidationClock({action:'spawn:generator-fix', ...})
  预期观察: 返回 {pipeline_started_at: 最新 fix.created_at, deadline_at: 最新 fix.created_at + timeout}，忽略 stale detail（re-derive，纯函数可重放）
  等待预算: 0s
  留证: vitest 输出末行（含 passed 计数）进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "deadline 顺延到最新 fix 原点" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-02: 顺延超上限 —— 7 轮 generator-fix deadline 冻结在第 6 次顺延原点（防无限续命）
  动作: 构造 decisionLog（首 generator + 7 行 spawn:generator-fix），调 real resolveValidationClock({action:'spawn:evaluator', ...})
  预期观察: 返回 pipeline_started_at = 第6次 fix.created_at（第7次被上限截断，不作原点），deadline_at = 第6次 fix.created_at + timeout
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "deadline 冻结在第 6 次顺延原点" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-03: 边界 —— 恰好 6 轮 generator-fix 仍顺延到第 6 次原点（上限内不冻结）
  动作: 构造 decisionLog（首 generator + 6 行 spawn:generator-fix），调 real resolveValidationClock({action:'spawn:judge', ...})
  预期观察: 返回 pipeline_started_at = 第6次 fix.created_at，deadline_at = 第6次 fix.created_at + timeout（min(6,6)=6，上限内仍顺延）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "恰好 6 轮 generator-fix 仍顺延到第 6 次原点" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-04: 回归守恒 —— 无 generator-fix 行时窗口仍以首 generator 原点算（语义不变）
  动作: 构造 decisionLog（仅首 generator，无 fix 行），调 real resolveValidationClock({action:'spawn:generator-fix', ...})
  预期观察: 返回 {pipeline_started_at: 首 generator.created_at, deadline_at: 首 generator.created_at + timeout}（fixCount=0 分支，走既有 persistedClock 语义）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "窗口仍以首 generator 原点算" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-05: fail-closed 守恒 —— 非 generator 系且无有效 origin 仍抛 validation_clock_required
  动作: 调 real resolveValidationClock({action:'spawn:judge', decisionLog:[], ...})（空 log、下游角色无时钟）
  预期观察: 抛 Error('validation_clock_required')（顺延逻辑不成为绕过 fail-closed 的旁路）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "仍抛 validation_clock_required" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-06: 既有 validation-clock 回归零回退（11 条 it 全绿，子 shell 用 packages/brain vitest 配置）
  动作: 子 shell 切进 packages/brain 跑既有 __tests__/validation-clock.test.js（fixCount=0 各分支：首原点/verified_pr/fail-closed/malformed/authoring role）
  预期观察: 11 条 it 全绿，本 sprint 顺延逻辑不改变任何 fixCount=0 结果
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js 2>&1 | grep -qE "[1-9][0-9]* passed"'

## Invariant 覆盖（铁律逐条映射）

- INV-1 [有界续命] validation clock 顺延每 run ≤6 次，超上限不再顺延、到期照常判死，禁无限续命 → 覆盖于 B-02（7 轮冻结第 6 次）+ B-03（恰好 6 轮仍顺延，min(n,6) 边界）+ ARTIFACT VALIDATION_CLOCK_EXTENSION_LIMIT=6
- INV-2 [fail-closed 守恒] 保留 validation_clock_required 默认 fail-closed，顺延逻辑不得成为绕过旁路 → 覆盖于 B-05 + B-06（malformed → validation_clock_invalid 守恒）
- INV-3 [纯函数可重放] 判定只依赖 decisionLog 行（hop 时序 + created_at），除 Date.now 外禁墙钟/外部状态；同 log 多次调用恒等 → 覆盖于 B-01（忽略 stale detail、re-derive from created_at）+ 全部用例无外部输入依赖
- INV-4 [红先行] bug 修复前先写复现 RED 测试、修复后永久留作回归守卫不得删 → 覆盖于 Test Contract 冻结守卫（RED: 3 failed | 2 passed (5) 已实证）+ 落 sprints/**/tests/ 经根 vitest 常驻 CI
