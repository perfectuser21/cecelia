---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: `resolveValidationClock` 的纯函数原点选择与冻结回归测试；不改默认 timeout、人审 deadline 或真库 loop 接缝。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现有界 fix 原点选择，Brain 版本按门禁同步。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!c.includes('resolveValidationClock'))process.exit(1)"
- [ ] [ARTIFACT] Sprint 冻结测试与 F1 回归测试保留在 CI。
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts','tests/gp/f1/validation-clock-fix-extension.test.ts']){if(!fs.readFileSync(p,'utf8').includes('resolveValidationClock'))process.exit(1)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 健康 fix 后 validation clock 以 fix 行为新原点
  动作: 用真实导出函数重放首个 generator 已超旧 deadline、随后 fix intent 与匹配 `effect:attempt_launched` 成功回执的日志。
  预期观察: 返回原点变为 fix 的 created_at，返回 deadline 晚于当前判定时刻。
  等待预算: 0s
  留证: Vitest 失败/通过输出中的原点与 deadline 断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t "r50 场景在成功 generator-fix 后以 fix 行为新原点存活"'

- [ ] [BEHAVIOR] [L2] B-01N: fix intent 派发失败或被阻断时不顺延
  动作: 用真实导出函数重放 fix intent 后只有 `effect:dispatch_result status=BLOCKED`、没有匹配 `effect:attempt_launched` 的日志。
  预期观察: 返回原点与 deadline 保持首个 generator clock，不把 intent 当成成功派发。
  等待预算: 0s
  留证: Vitest 输出中的原始 clock 精确相等断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t "generator-fix 只有 intent 而派发失败或被阻断时不顺延"'

- [ ] [BEHAVIOR] [L2] B-02: 前 6 次 fix 后第 7 次不再顺延
  动作: 用真实导出函数重放含 7 个按 hop 排列 generator-fix 的日志。
  预期观察: 返回原点精确停在第 6 个 fix，后续 fix 不扩大 deadline。
  等待预算: 0s
  留证: Vitest 输出中的第 6 次原点与精确 deadline 断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第 7 次 generator-fix 不再顺延"'

- [ ] [BEHAVIOR] [L2] B-03: 无 fix 轮语义不变
  动作: 用真实导出函数重放只有首个 generator 的日志。
  预期观察: 原点仍为首个 generator，deadline 仍精确增加 5400 秒。
  等待预算: 0s
  留证: Vitest 输出中的旧语义深相等断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t "无 generator-fix 时保持首个 generator 原点语义"'

- [ ] [BEHAVIOR] [L2] B-04: 日志按 hop 确定性重放
  动作: 将相同日志行以正序与逆序分别传给真实导出函数。
  预期观察: 两次 clock 结果深相等，不依赖输入数组物理顺序或外部状态。
  等待预算: 0s
  留证: Vitest 输出中的两次结果深相等断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t "相同乱序日志按 hop 重放得到相同 clock"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: `validation_clock_required` 默认 fail-closed 与 verified-existing-PR 原点不回退
  动作: 运行 validation-clock 既有完整单测套件。
  预期观察: 下游缺 clock 仍抛错，verified-existing-PR Evaluator/Judge 行为全绿。
  等待预算: 30s
  留证: 包级 Vitest 完整输出与 exit code。
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)'

- N/A（其余 PRD 铁律）: 本 Sprint 不触及账号凭据、nightly、Android/真机、租户/API/PII、部署、通知、数据库 schema、relay、PR merge 或外部服务；其约束无可由本纯函数交付物执行的新增行为。
