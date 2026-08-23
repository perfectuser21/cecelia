---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: `resolveValidationClock` 的 pipeline 原点选择与永久回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 生产纯函数实现、冻结 F1 回归测试与 Brain `DEFINITION.md` 版本同步进入同一交付
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/validation-clock.js','packages/brain/DEFINITION.md','sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js'])fs.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 型长跑在有效 fix 新期限内保持存活
  动作: 用真实 import 调用 `resolveValidationClock`，传首次 Generator 与第 1 次成功 fix 日志。
  预期观察: 返回原点推进到 fix 时间，旧期限之后仍早于新 deadline。
  等待预算: 0s
  留证: Vitest 精确对象断言与进程 exit code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t "r50 型长跑在第 1 次 fix 新期限内保持存活"'

- [ ] [BEHAVIOR] [L2] B-02: 日志乱序仍按 hop 选第 6 次 fix
  动作: 用乱序 decision log 真调生产函数并重放 6 次 fix。
  预期观察: 数组顺序不影响结果，第 6 次 fix 是新原点。
  等待预算: 0s
  留证: Vitest 精确 ISO 原点与 deadline 断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t "乱序输入仍按 hop 重放并选第 6 次 fix 为新原点"'

- [ ] [BEHAVIOR] [L2] B-03: 第 7 次及以后 fix 不再顺延
  动作: 用含 8 次 fix 的 decision log 真调生产函数。
  预期观察: 返回期限仍锚定第 6 次 fix，第 7、8 次不延寿。
  等待预算: 0s
  留证: Vitest 精确对象断言，失败时保留 diff。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t "第 7 次及以后 fix 不再顺延并沿用第 6 次期限"'

- [ ] [BEHAVIOR] [L2] B-04: 无 fix 轮保持现有语义
  动作: 仅传首次 Generator 日志真调生产函数。
  预期观察: 原点和 deadline 与修复前语义完全一致。
  等待预算: 0s
  留证: Vitest 精确对象断言与 exit code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t "无 fix 轮时保持首次 generator 原点语义"'

## Invariant 条目

- INV-1 重试身份：N/A — 不改 dispatcher/derive 的重试 action。
- INV-2 现有 PR 时钟：既有 `validation-clock.test.js` 必须全绿，保持 existing-PR 与 fail-closed。
- INV-3 Planner 分支：N/A — 不触及 checkout。
- INV-4 目标环境：N/A — 不从文件推断环境，执行路由沿用 task payload local_api。
