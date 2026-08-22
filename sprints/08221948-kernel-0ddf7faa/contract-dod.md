---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 验证窗对多轮 fix 链自动顺延

**范围**: `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` / `persistedClock` — 锚 hop 之后每出现一次 `spawn:generator-fix` 即把窗口顺延一个 `timeoutSeconds`（deadline = anchor_started + (1+fixCount)*timeout），persisted 容忍顺延后 deadline。runner 侧不变。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `resolveValidationClock` 顺延实现落在受影响文件（不越界改 runner）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/generator-fix/.test(c)||!/timeoutSeconds/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 冻结 sprint 测试存在并含顺延断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js','utf8');if(!c.includes('resolveValidationClock')||!c.includes('generator-fix'))process.exit(1)"

## BEHAVIOR 条目（五行剧本，全部 real-exec，evaluator GREEN 阶段执行）

- [ ] [BEHAVIOR] [L2] B-01: 冻结 sprint 测试全绿（从仓库根跑，命中根 vitest include sprints/**）
  动作: 从仓库根执行 `npx vitest run` 冻结测试文件
  预期观察: 6 个用例全部通过，无 failed
  等待预算: 0s
  留证: /tmp/frozen.log 末尾 `Tests N passed`
  Test: manual:bash -c 'cd /workspace && OUT=$(npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache 2>&1); echo "$OUT" | grep -qE "[0-9]+ failed" && { echo FAIL; exit 1; }; echo "$OUT" | grep -qE "Tests +[0-9]+ passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 2 次 generator-fix → 窗口顺延两个 timeout（one timeout per generator-fix）
  动作: 构造锚 hop + 2 个 spawn:generator-fix 的 decisionLog，调 resolveValidationClock
  预期观察: deadline_at == started + 3*timeout（2026-08-04T01:02:13.199Z）
  等待预算: 0s
  留证: vitest -t 该用例输出 `Tests 1 passed`
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache -t "one timeout per generator-fix" 2>&1 | grep -qE "Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 1 次 generator-fix → 窗口顺延一个 timeout（exactly one timeout for a single generator-fix）
  动作: 构造锚 hop + 1 个 spawn:generator-fix 的 decisionLog，调 resolveValidationClock
  预期观察: deadline_at == started + 2*timeout（2026-08-03T23:02:13.199Z）
  等待预算: 0s
  留证: vitest -t 该用例输出 `Tests 1 passed`
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache -t "exactly one timeout for a single generator-fix" 2>&1 | grep -qE "Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: persisted 锚 detail 已顺延值不误判 invalid（tolerates a persisted anchor clock already advanced）
  动作: 锚 detail.deadline_at 写成顺延后值 + 2 个 fix，调 resolveValidationClock
  预期观察: 不 throw validation_clock_invalid，返回 deadline == started + 3*timeout
  等待预算: 0s
  留证: vitest -t 该用例输出 `Tests 1 passed`
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache -t "tolerates a persisted anchor clock already advanced" 2>&1 | grep -qE "Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1 [有界运行] B-05: 顺延窗口精确线性有界（finite and exactly linear for a bounded fix count）
  动作: 构造锚 hop + 5 个 spawn:generator-fix 的 decisionLog，调 resolveValidationClock
  预期观察: deadline_at == started + 6*timeout（2026-08-04T07:02:13.199Z），有限、精确线性、不无界增长
  等待预算: 0s
  留证: vitest -t 该用例输出 `Tests 1 passed`
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache -t "finite and exactly linear for a bounded fix count" 2>&1 | grep -qE "Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [零回归] B-06: 零 fix 窗口逐字节不变（byte-for-byte unchanged when no generator-fix）
  动作: decisionLog 仅含锚 hop（无 generator-fix），调 resolveValidationClock
  预期观察: deadline_at == started + 1*timeout（2026-08-03T21:02:13.199Z），与现行为逐字节一致
  等待预算: 0s
  留证: vitest -t 该用例输出 `Tests 1 passed`
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js --no-cache -t "byte-for-byte unchanged when no generator-fix" 2>&1 | grep -qE "Tests +1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [零回归] B-07: 既有 kernel validation-clock 测试全绿（子 shell 用包自身 vitest 配置）
  动作: cd packages/brain，跑既有 src/orchestrator/__tests__/validation-clock.test.js
  预期观察: 既有 11 断言全通过，无 failed
  等待预算: 0s
  留证: /tmp/pkg.log 末尾 `Tests 11 passed`
  Test: manual:bash -c 'cd /workspace/packages/brain && OUT=$(npx vitest run src/orchestrator/__tests__/validation-clock.test.js --no-cache 2>&1); echo "$OUT" | grep -qE "[0-9]+ failed" && { echo FAIL; exit 1; }; echo "$OUT" | grep -qE "Tests +[0-9]+ passed" || { echo FAIL; exit 1; }; echo OK'

## Invariant 铁律映射（Step 1.3）

- INV-1 [有界运行] → B-05（顺延窗口精确线性、有限；fixCount 由既有 fix 轮上限约束，函数层不引入无界循环/溢出）
- INV-2 [零回归] → B-06 + B-07（fixCount=0 逐字节一致 + 既有 11 断言全绿）
- INV-3 [runner 不变] → N/A：本 sprint 受影响文件仅 `validation-clock.js` + 冻结测试，不触及 runner 断言预算逻辑（不在受影响文件清单，无对应交付物可断言）
- INV-4 [凭据隔离] → N/A：本 sprint 为 kernel 纯计算函数改动，无凭据/授权操作
