---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel validation clock 按 fix 轮自动顺延（有界）[r68]

**范围**: 只改 `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 顺延逻辑（generator-fix 原点推进 + 6 次上限），不改 `timeout_seconds` 默认值、不动人审 deadline、不改 loop.js 集成接缝。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结契约测试存在且真 import 被改模块（禁 mock 被改的边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts','utf8');if(!c.includes('../../../packages/brain/src/orchestrator/validation-clock.js'))process.exit(1)"

- [ ] [ARTIFACT] tests/gp/f1 CI 常驻回归副本存在且真 import 被改模块
  Test: node -e "const c=require('fs').readFileSync('tests/gp/f1/step3-validation-clock-fix-round-extension.test.js','utf8');if(!c.includes('../../../packages/brain/src/orchestrator/validation-clock.js'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；纯函数单测，同步观察 等待预算 0s）

- [ ] [BEHAVIOR] [L2] B-01: downstream 角色采纳最近一次 generator-fix 原点（复刻 r50 存活）
  动作: 以「G0@t0 + 两轮健康 fix（F1@00:40、F2@01:20）」的 decisionLog 调 `resolveValidationClock({action:'spawn:evaluator', timeoutSeconds:5400})`
  预期观察: 返回 `pipeline_started_at='2026-08-24T01:20:00.000Z'`（最近 fix 原点）、`deadline_at='2026-08-24T02:50:00.000Z'`（+5400s），旧逻辑判死点被顺延到未来
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行（含 "Tests N passed"）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && OUT=$(npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-01 顺延" --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: 顺延有界——fix 轮 > 6 时原点冻结在第 6 次 fix（超限照常判死）
  动作: 以「G0 + 8 轮 fix（00:10…01:20）」的 decisionLog 调 `resolveValidationClock({action:'spawn:evaluator', timeoutSeconds:5400})`
  预期观察: 返回 `pipeline_started_at='2026-08-24T01:00:00.000Z'`（第 6 次 fix）、`deadline_at='2026-08-24T02:30:00.000Z'`，且 deadline 不等于第 8 次 fix 顶出的 02:50
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && OUT=$(npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-02 有界" --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 无 fix 轮时 deadline 与旧逻辑逐字节一致（零回归）
  动作: 以只含初始 `spawn:generator`（无 generator-fix 行）的 decisionLog 调 `resolveValidationClock`
  预期观察: 返回 `pipeline_started_at=t0`、`deadline_at=t0+5400s`，与改动前逐字节相同
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && OUT=$(npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-03 语义不变" --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-1 [existing-PR-clock]: existing-PR evaluator origin 复用路径不受 fix 顺延影响
  动作: 以「verified_existing_pr evaluator origin（最低 hop）+ 混入一条 generator-fix 行」的 decisionLog 调 `resolveValidationClock({action:'spawn:judge'})`
  预期观察: 返回复用 evaluator 持久化时钟 `pipeline_started_at=t0`，未被混入的 fix 行顶动（铁律不破）
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && OUT=$(npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-04 Invariant" --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: 恰好 6 轮 fix 时原点采纳第 6 次 fix（边界，未超限）
  动作: 以「G0 + 恰好 6 轮 fix（00:10…01:00）」的 decisionLog 调 `resolveValidationClock`
  预期观察: 返回 `pipeline_started_at='2026-08-24T01:00:00.000Z'`（第 6 次）、`deadline_at='2026-08-24T02:30:00.000Z'`
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && OUT=$(npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-05 恰好 6 轮" --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

- [ ] [BEHAVIOR] [L2] REG: 既有 validation-clock 单测零回归（切进包根跑，vitest 工作目录死规则）
  动作: 切进 packages/brain 包根跑既有 `src/orchestrator/__tests__/validation-clock.test.js`
  预期观察: 既有 11 条断言全绿（首个 origin/复用/pre-fix 恢复/fail-closed/existing-PR/畸形时钟/authoring null 全部不受本改动影响）
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain" && OUT=$(npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=dot 2>&1); echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -q "failed" && echo OK || { echo "$OUT"; exit 1; }'

## Invariant 铁律映射（Step 1.3 — 逐条 INV 或 N/A）

- INV-1 [existing-PR-clock] → 上方 `- [ ] [BEHAVIOR] INV-1` 条目覆盖（existing-PR evaluator origin 复用路径不顺延）
- INV-2 [retry-identity] → N/A：本 sprint 不触及基础设施重试身份逻辑，`resolveValidationClock` 不读/改 attempt/account/origin 身份，仅按 decision_log 行时序算时钟
- INV-3 [planner-role-branch] → N/A：本 sprint 不涉及 planner checkout；proposer/generator 均使用服务端签发分支，被改文件与分支签发无关
