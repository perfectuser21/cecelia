---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: `validation-clock.js` 纯函数、F1 回归测试及 Brain `DEFINITION.md` 版本同步；不改默认 timeout、人审 deadline、loop.js。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 实现保持在 `packages/brain/src/orchestrator/validation-clock.js`，并同步 `packages/brain/DEFINITION.md` 版本。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/validation-clock.js','packages/brain/DEFINITION.md'])fs.accessSync(p)"
- [ ] [ARTIFACT] 冻结测试与 F1 回归测试均已提交。
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts','tests/gp/f1/validation-clock-fix-extension.test.ts'])fs.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 型长跑在三次成功 fix 后以最近 fix 重置时钟
  动作: 用含三组 fix intent 与 attempt:launched receipt 的 decision log 调用真实 resolveValidationClock。
  预期观察: 返回原点 00:03:00Z 与 deadline 00:04:40Z，旧实现返回原始 clock 因而失败。
  等待预算: 0s
  留证: Vitest verbose 输出中的测试名、expected/received 与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "r50 场景最近一次成功 fix"'

- [ ] [BEHAVIOR] [L2] B-02: 六次成功 fix 按 hop 重放仍取第六次
  动作: 打乱 decision log 数组物理顺序后调用真实 resolveValidationClock。
  预期观察: 纯函数按 hop 得到第六次 fix 原点及其 deadline。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "恰好六次成功 fix"'

- [ ] [BEHAVIOR] [L2] B-03: 第七次成功 fix 不再顺延
  动作: 用七组成功 fix intent/receipt 调用真实 resolveValidationClock。
  预期观察: 返回第六次原点 00:06:00Z 与 deadline 00:07:40Z，而非第七次。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第七次成功 fix"'

- [ ] [BEHAVIOR] [L2] B-04: 未成功派发的 fix 与无 fix 语义不变
  动作: 用仅有 fix intent、无匹配 attempt:launched receipt 的日志调用真实 resolveValidationClock。
  预期观察: 返回原始 generator clock，不因未派发 intent 续命。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "没有成功 launch receipt"'

- [ ] [BEHAVIOR] [L2] B-05: 同一 fix 的重复 receipt 最多贡献一次顺延
  动作: 为第一个 fix 追加重复 attempt:launched receipt，并保留六个唯一成功 fix 后调用真实 resolveValidationClock。
  预期观察: 重复 receipt 不占额外名额，第六个唯一 fix 仍建立 00:06:00Z 原点。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "重复 launch receipt"'

- [ ] [BEHAVIOR] [L2] B-06: receipt 的 dispatch_hop 与 dispatch_action 必须共同匹配
  动作: 在一个已成功 fix 后，分别输入 hop 指向不存在 intent、action 指向 spawn:generator 的 receipt，再调用真实 resolveValidationClock。
  预期观察: 两类不匹配 receipt 均不使后续 generator-fix 顺延，仍返回首个合法 fix 的 clock。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t "dispatch_hop 或 dispatch_action"'

## Invariant 覆盖

- [ ] [BEHAVIOR] [L2] INV-1 已有 PR clock fail-closed 与 evaluator-origin 例外不回退
  动作: 执行现有 validation-clock 回归测试全集。
  预期观察: 所有既有 clock 测试通过且畸形/缺失 clock 仍抛错。
  等待预算: 10s
  留证: Vitest 输出与 exit_code。
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)'
- N/A（派发身份）：本 sprint 不改变 derive/dispatcher 的重派 action。
- N/A（Planner 分支）：本 sprint 不涉及 Planner workspace。
- [ ] [BEHAVIOR] [L2] INV-2 验证命令真实运行并以 exit code 判定
  动作: 执行 sprint 冻结测试全集。
  预期观察: 未实现时非零、实现后四条测试均为零退出。
  等待预算: 10s
  留证: Red/Green 两次 Vitest log 与 exit_code。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts'
- N/A（证据窗口）：由 Evaluator/Judge 证据协议执法，不改该路径。
- [ ] [BEHAVIOR] [L2] INV-3 真实接缝未冒充 done
  动作: 核对合同接缝状态。
  预期观察: 真库 loop.js 接缝明确标为 logic-done-pending。
  等待预算: 0s
  留证: contract-draft.md 未覆盖真实链路清单。
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/08240522-kernel-r64-validation-clock/contract-draft.md\",\"utf8\");if(!c.includes(\"logic-done-pending\"))process.exit(1)"'
- N/A（环境假设）：测试时间与日志 shape 均由输入构造，不读取环境默认值。
- N/A（凭据安全）：无凭据输入与输出。
- N/A（日志脱敏）：测试数据不含 PII。
- N/A（单写手）：由 Harness 单 Generator 调度保证。
