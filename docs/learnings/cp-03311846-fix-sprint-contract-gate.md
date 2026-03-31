# Learning: fix-sprint-contract-gate

**Branch**: cp-03311846-fix-sprint-contract-gate
**Date**: 2026-03-31

## 问题

Sprint Contract 机制形同虚设——对抗流程运行 0 次。根本原因是 `verify_step1()` 只校验 DoD Test 字段的格式，完全不检查 Sprint Contract seal 文件是否存在。主 agent 可以直接手填 Test 字段绕过整个 Generator + Evaluator 对抗流程。

### 根本原因

`verify-step.sh` 的 State Machine 强制层在 `step_1_spec: done` 时没有要求 Sprint Contract 产物存在。`devloop-check.sh` 虽然有 Sprint Contract 检查（条件 1.5/1.6），但只在 Stop Hook 触发时才运行，属于事后检查，没有阻止主 agent 跳过对抗流程直接进入 Stage 2。

### 下次预防

- [ ] 所有"流程门禁"检查必须在 `verify-step.sh` 的对应 step 入口处做，而不是依赖 Stop Hook 的后置检查
- [ ] 每次新增 Sprint Contract 相关文件要求时，同步更新 `verify_step1()` 检查清单
- [ ] `divergence_count` 必须 ≥ 1（橡皮图章检测），纯橡皮图章的 Evaluator 等于没有运行对抗

## 修复方案

在 `verify_step1()` 的 Gate Planner 检查之后、`_pass` 调用之前，添加三项强制检查：
1. `.dev-gate-generator-sprint.{branch}` 存在性检查
2. `.dev-gate-spec.{branch}` 存在性 + `verdict=PASS` + `divergence_count ≥ 1`
3. `.sprint-contract-state.{branch}` 存在性 + `round ≥ 1`

任一不满足则 exit 1，迫使 Sprint Contract 对抗流程真实运行。

## DoD Test 字段教训

1. **PRESERVE 类型禁止自引用"TODO"字符串**: 检查"禁止 TODO"的测试命令本身不能包含字符串"TODO"，否则 check-dod-mapping.cjs 的 `/TODO/.test(testCommand)` 会拒绝它。用 `c.match(/Test:\[\[:space:\]\]/)` 代替 `c.includes('Test:[[:space:]]*TODO')`。

2. **BEHAVIOR 测试路径**: `packages/engine/tests/` 开头的路径不被识别为有效 `tests/` 引用。需用 `manual:bash -c "..."` 内联测试命令，创建临时目录调用 verify-step.sh 验证行为。

3. **GATE 测试需要显式 process.exit**: `accessSync` 抛出异常本身不够，必须加 `process.exit(0)/process.exit(1)` 让 check-dod-mapping.cjs 看到明确断言。
