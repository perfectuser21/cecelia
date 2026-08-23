---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现有界 fix clock，且按 Brain 规则同步 `packages/brain/DEFINITION.md` 版本
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/validation-clock.js','packages/brain/DEFINITION.md'])fs.accessSync(p)"
- [ ] [ARTIFACT] 冻结测试与 required CI 测试真实落盘
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts','tests/gp/f1/validation-clock-fix-extension.test.js'])fs.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 场景最近成功 fix 刷新原点并保持存活
  动作: 用真实导出函数处理初始 clock 已过期、最近 fix 尚未过期的决策日志
  预期观察: 返回原点更新为最近合格 fix，deadline 使用同一 timeoutSeconds 重算
  等待预算: 0s
  留证: Vitest 失败或通过输出中的用例名、expected 与 received
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t "r50 场景：最近成功 fix 刷新原点并保持存活"'

- [ ] [BEHAVIOR] [L2] B-02: 乱序日志按 hop 可重放
  动作: 将相同决策行以乱序数组连续输入真实函数两次
  预期观察: 两次返回完全一致，并选中 hop 最大的合格 fix 原点
  等待预算: 0s
  留证: Vitest deep equality 与原点断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t "乱序日志按 hop 可重放"'

- [ ] [BEHAVIOR] [L2] B-03: 第 7 次 fix 不再延长 deadline
  动作: 输入初始 generator 与 7 次依 hop 排序的成功 fix 行
  预期观察: 返回原点停在第 6 次 fix，第 7 次时间不生效
  等待预算: 0s
  留证: Vitest 对第 6 与第 7 时间的正反断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第 7 次 fix 不再延长 deadline"'

- [ ] [BEHAVIOR] [L2] B-04: 无 fix 轮保持原有 generator clock
  动作: 只输入已有 spawn:generator 决策行调用真实函数
  预期观察: 原点仍为初始 generator 时间，deadline 仍为原点加既有 timeout
  等待预算: 0s
  留证: Vitest 原点与 deadline 精确值输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t "无 fix 轮保持原有 generator clock"'

- [ ] [BEHAVIOR] [L2] INV-1: 纯函数边不被 mock 且真实 import 被改模块
  动作: 执行 required CI 路径下的真实模块导入回归测试
  预期观察: 测试直接调用 resolveValidationClock，无 vi.mock 或 stub
  等待预算: 0s
  留证: required CI Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js'

## Invariant 映射

- 重试身份、Planner分支、Brain权威URL、证据窗口、单槽串行、凭据安全、日志脱敏、租户隔离：N/A，本 Sprint 不触及对应模块或外部资源。
- 时钟接入：由真实 import 及既有 `loop.js` 调用 shape 保持约束；真库接缝已明确登记未覆盖。
- 命令真跑、测试质量：由 B-01 至 B-04 与 INV-1 直接执行真实函数覆盖。
- 环境真验：纯函数 local_api 真执行完成；真库 loop 接缝不冒充完成。
