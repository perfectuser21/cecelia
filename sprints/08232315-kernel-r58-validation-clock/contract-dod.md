---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 有界顺延

**范围**: 只改 pipeline validation clock 原点选择；不改默认 timeout、人审 deadline。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现有界 fix 重锚，`packages/brain/DEFINITION.md` 版本同步。
  Test: git diff --name-only 422633217348366974b6c28ceeaba7f587070a51...HEAD | grep -E '^(packages/brain/src/orchestrator/validation-clock.js|packages/brain/DEFINITION.md)$'
- [ ] [ARTIFACT] 永久 GP 测试位于 `tests/gp/f1/validation-clock-bounded-fix-extension.test.js` 且真 import 目标模块。
  Test: node -e "const fs=require('fs');const p='tests/gp/f1/validation-clock-bounded-fix-extension.test.js';const c=fs.readFileSync(p,'utf8');const frozen=fs.readFileSync('sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts','utf8');if(!c.includes('sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts')||!frozen.includes('packages/brain/src/orchestrator/validation-clock.js')||/vi\\.mock|jest\\.mock|sinon\\.stub/.test(c+frozen))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 两轮 fix 后旧窗口耗尽但最近 fix 窗口内仍存活
  动作: 用真实目标模块重放首次 generator 加两轮 generator-fix 的 decision log。
  预期观察: 起点移动到第二轮 fix，deadline 晚于观察时刻，不再误杀健康 run。
  等待预算: 0s
  留证: Vitest verbose 输出中的测试名与精确 clock diff。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t "r50 两轮 fix 后原窗口耗尽但最近 fix 窗口内仍存活"'

- [ ] [BEHAVIOR] [L2] B-02: 六次内按 hop 选择最新原点且纯函数可重放
  动作: 将含六轮 fix 的相同行序列倒序输入真实目标模块并执行两次。
  预期观察: 两次结果严格相等，起点为 hop 最大的第六轮 fix。
  等待预算: 0s
  留证: Vitest verbose 输出与 `toEqual` 失败差异。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t "前六次 fix 各自按 hop 顺序成为新原点且输入可重放"'

- [ ] [BEHAVIOR] [L2] B-03: 第七次 fix 不续命并按第六次 deadline 判死
  动作: 重放七轮 fix，并在第六次 deadline 之后观察返回 clock。
  预期观察: 第七次不改变起点，deadline 早于观察时刻，超限照常死亡。
  等待预算: 0s
  留证: Vitest verbose 输出中的第六次起点和 deadline 精确值。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t "第七次 fix 不再顺延并保留第六次原点使超时照常判死"'

- [ ] [BEHAVIOR] [L2] B-04: 无 fix 轮语义不变
  动作: 仅输入首次 generator 行并调用真实目标模块。
  预期观察: 起点仍为首次 generator，deadline 仍为起点加原 timeout。
  等待预算: 0s
  留证: Vitest verbose 输出与精确对象断言。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t "无 fix 轮时继续以首次 generator 为原点"'

- [ ] [BEHAVIOR] [L2] INV-1: 首次 generator 与 generator-fix 身份不混淆
  动作: 运行四场景全集并检查各自精确起点。
  预期观察: 0 fix 用首次 generator，1-6 fix 用对应最新 fix，7 fix 仍用第六次。
  等待预算: 0s
  留证: 全套 Vitest verbose 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts --reporter=verbose'

## 铁律 N/A 映射

- Planner 分支：N/A，本 sprint 不触及 planner workspace。
- Brain URL：N/A，本 sprint 是无网络纯函数。
- 基线冻结：由 E2E `merge-base` 断言 implementation baseline。
- 真实门禁：由五条 BEHAVIOR 真 import 同一目标模块覆盖。
