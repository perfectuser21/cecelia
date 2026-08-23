---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: 仅 `resolveValidationClock` pipeline deadline 原点选择、冻结回归与 Brain DEFINITION 版本同步。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现最多 6 次 fix 顺延，且 `packages/brain/DEFINITION.md` 同步版本说明。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/validation-clock.js','packages/brain/DEFINITION.md']){if(!fs.readFileSync(p,'utf8').trim())process.exit(1)}"
- [ ] [ARTIFACT] 两份 Test Contract 冻结测试真实存在并进入 commit。
  Test: git ls-files --error-unmatch tests/gp/f1/validation-clock-fix-extension.test.js sprints/08240205-kernel-r61-validation-clock/tests/validation-clock-fix-extension.test.js

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 长跑在第 6 次 fix 后仍存活
  动作: 用固定 hop 日志调用真实 `resolveValidationClock`，包含初始 generator 与 6 次 generator-fix。
  预期观察: pipeline 原点为第 6 次 fix，deadline 从该原点增加 5400 秒。
  等待预算: 0s
  留证: Vitest verbose 输出中的测试名、expected/received 与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "r50 long run extends from latest eligible generator-fix and remains alive"'

- [ ] [BEHAVIOR] [L2] B-02: 第 7 次 fix 不再顺延
  动作: 用含 7 次 generator-fix 的固定 hop 日志调用真实模块。
  预期观察: 返回原点仍是第 6 次 fix，而不是第 7 次。
  等待预算: 0s
  留证: Vitest verbose 输出中的精确 ISO 时间与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "seventh generator-fix does not extend beyond the sixth fix"'

- [ ] [BEHAVIOR] [L2] B-03: 无 fix 轮保持原语义
  动作: 仅传入初始 spawn:generator 行并调用真实模块。
  预期观察: 原点为初始 generator created_at，deadline 恰加 5400 秒。
  等待预算: 0s
  留证: Vitest 输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "no fix preserves the initial generator clock"'

- [ ] [BEHAVIOR] [L2] B-04: 相同 decision log 可确定性重放
  动作: 对同一 action、hop 日志、intentAt 和 timeout 连续调用真实模块两次。
  预期观察: 两次完整返回值深相等，且最新有效 fix 是原点。
  等待预算: 0s
  留证: Vitest 输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "same decision-log replay returns an identical clock"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-01: validation_clock_required 默认 fail-closed、verified existing-PR evaluator、人审 deadline 与 authoring role 既有语义不回退
  动作: 运行 validation-clock 既有包级回归，不修改 timeout 默认值或 human review 逻辑。
  预期观察: 既有 validation clock 测试全部通过。
  等待预算: 30s
  留证: 包级 Vitest 输出与 exit code
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)'

- 其余 PRD「Invariant 约束」逐条 N/A：本 sprint 不触及账号授权、通知、nightly、Android/RPA、租户/API/auth、凭据、发布、部署、relay、数据库写入或外部服务；不得借本单修改这些路径。
- secrets/PII 铁律适用且由静态范围满足：测试仅含固定非业务时间与 action/hop，不含凭据或用户数据。

## 失败语义

- 任何精确时间、上界、重放或既有回归不符均由测试非零退出阻塞；无跳过、无 404 兼容、无 `|| true`。
- 真库 `loop.js` 接缝未覆盖，保持 `logic-done-pending`，不以本 DoD 宣称完成。
