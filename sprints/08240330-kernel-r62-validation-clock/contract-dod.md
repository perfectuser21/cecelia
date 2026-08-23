---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: 仅 `validation-clock.js` 纯函数、冻结回归测试及 Brain 版本同步；不改默认 timeout、人审 deadline、loop.js。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结测试真实存在并直接 import `packages/brain/src/orchestrator/validation-clock.js`
  Test: node -e "const fs=require('fs');const p='sprints/08240330-kernel-r62-validation-clock/tests/validation-clock-fix-extension.test.ts';const c=fs.readFileSync(p,'utf8');if(!c.includes(\"from '../../../packages/brain/src/orchestrator/validation-clock.js'\")||/vi\.mock|jest\.mock|stub/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Brain 行为版本与 DEFINITION 同步且默认 timeout 未被合同改写
  Test: node -e "const p=require('./packages/brain/package.json');const d=require('fs').readFileSync('./packages/brain/DEFINITION.md','utf8');if(!d.includes(p.version))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 型长跑在最近成功 fix deadline 内保持存活
  动作: 用初始 deadline 已过、最近 fix deadline 未过的真实 decision-log row shape 调用真 `resolveValidationClock`。
  预期观察: clock 原点刷新到最近成功 fix，deadline 晚于观察时刻。
  等待预算: 0s
  留证: Vitest verbose 输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240330-kernel-r62-validation-clock/tests/validation-clock-fix-extension.test.ts -t "r50 型长跑在最近成功 fix deadline 内保持存活" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 前 6 次成功 fix 均按 hop 选择最近一轮作为新原点
  动作: 将包含 6 次 fix 的 decision log 逆序传入真函数。
  预期观察: 函数按 hop 而非数组位置选择第 6 次 fix 并重算 deadline。
  等待预算: 0s
  留证: Vitest verbose 输出与第 6 次原点断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240330-kernel-r62-validation-clock/tests/validation-clock-fix-extension.test.ts -t "前 6 次成功 fix 均按 hop 选择最近一轮作为新原点" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 第 7 次 fix 不再顺延并按第 6 次 deadline 判死
  动作: 传入 7 次 fix，并把观察时刻放在第 6 次 deadline 之后。
  预期观察: 第 7 次不成为原点，返回 deadline 不晚于观察时刻。
  等待预算: 0s
  留证: Vitest verbose 输出与 deadline 比较断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240330-kernel-r62-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第 7 次 fix 不再顺延并按第 6 次 deadline 判死" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 无 fix 轮语义不变且相同 hop 输入可确定重放
  动作: 对零 fix 输入和重新构造的等价输入各调用一次真函数。
  预期观察: 两次均复用初始 generator clock，结果深相等。
  等待预算: 0s
  留证: Vitest verbose 输出与 replay 深相等断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240330-kernel-r62-validation-clock/tests/validation-clock-fix-extension.test.ts -t "无 fix 轮语义不变且相同 hop 输入可确定重放" --reporter=verbose'

## Invariant 验收

- [ ] [ARTIFACT] INV-1/13/14：派发身份不变、单 ws、Planner 分支不被合同替换。
- [ ] [ARTIFACT] INV-2/3：fail-closed 既有测试保留，验证真相为直接 import 真模块。
- [ ] [ARTIFACT] INV-4/5/7/8：RED→GREEN exit code 留证，精确 RED commit，TDD/coverage 门禁必过。
- [ ] [ARTIFACT] INV-6：Test Contract 四列且完整冻结路径可解析。
- [ ] [ARTIFACT] INV-9：loop.js 真库接缝仅登记 `logic-done-pending`。
- [ ] [ARTIFACT] INV-10/11/12：输入推导时间，无凭据、PII 或聊天日志。

