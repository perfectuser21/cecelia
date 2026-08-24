---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: 仅修改 pipeline validation clock 原点选择与回归测试；不改默认 timeout、人审 deadline、loop.js 集成。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现最多六次成功 fix 顺延。
  Test: node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{if(typeof m.resolveValidationClock!=='function')process.exit(1)})"
- [ ] [ARTIFACT] `packages/brain/DEFINITION.md` 的 Brain 版本按门禁同步更新。
  Test: bash scripts/check-version-sync.sh
- [ ] [ARTIFACT] sprint 冻结测试与 GP F1 永久回归测试均存在且由 Vitest 收集。
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08240905-kernel-r67-validation-clock/tests/validation-clock-contract.test.ts','tests/gp/f1/step3-validation-clock-fix-extension.test.js'])if(!fs.readFileSync(p,'utf8').includes('resolveValidationClock'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 类健康 run 由最新成功 fix 重置时钟
  动作: 将 generator、三次 generator-fix intent 及逐一以 dispatch_hop 锚定的 effect:attempt_launched 回执传给 resolver
  预期观察: 返回第三次 fix 的开始时间与精确增加 5400 秒的 deadline
  等待预算: 0s
  留证: Vitest 输出中的用例名与 expected/received diff
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "r50 类场景由最新成功 fix 重置时钟"'

- [ ] [BEHAVIOR] [L2] B-02: 第七次成功 fix 不再顺延
  动作: 输入 generator 与七次成功 generator-fix 行
  预期观察: 返回第六次 fix 原点，第七次不改变 deadline
  等待预算: 0s
  留证: Vitest 输出中的第六次原点断言
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "第七次成功 fix 不再顺延"'

- [ ] [BEHAVIOR] [L2] B-03: 零次 fix 保持 generator 原点语义
  动作: 仅输入已有持久化时钟的 spawn:generator 行
  预期观察: resolver 返回原持久化时钟，不改变默认语义
  等待预算: 0s
  留证: Vitest 严格相等断言输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "零次 fix 保持 generator 原点语义"'

- [ ] [BEHAVIOR] [L2] B-04: 裸 fix intent 与乱序输入不产生额外顺延
  动作: 输入缺少 effect:attempt_launched 回执的 fix intent 及乱序日志
  预期观察: 裸 intent 被排除，结果只由成功派发的有效 hop 时序决定且可重放
  等待预算: 0s
  留证: 两个 Vitest 用例输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "没有 attempt_launched 成功回执的 fix 不顺延|乱序输入按 hop 重放得到同一时钟"'

- [ ] [BEHAVIOR] [L2] B-05: 同 hop 重复行只消耗一次顺延额度
  动作: 输入六个成功 fix 及第一 fix 的同 hop 重复 intent
  预期观察: 重复 hop 去重后仍以第六个唯一成功 fix 为原点
  等待预算: 0s
  留证: Vitest 第六个唯一 fix 原点断言输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "同 hop 重复 fix 行只消耗一次顺延额度"'

- [ ] [BEHAVIOR] [L2] INV-1: generator-fix 重试身份保持原 action
  动作: 运行 validation clock 测试并检查输入/输出均使用 spawn:generator-fix
  预期观察: fix 行只改变时钟原点，不改变派发 action
  等待预算: 0s
  留证: Vitest 运行输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js'

- [ ] [BEHAVIOR] [L2] INV-2: validation clock 继续 fail-closed
  动作: 运行既有 validation-clock 回归套件
  预期观察: 非法时钟与缺失原点用例继续通过既有抛错断言
  等待预算: 0s
  留证: package Vitest 输出
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)'

## Invariant 映射

- [重试身份] → INV-1。
- [既有时钟] → INV-2。
- [真环境验证] → loop.js 真库接缝登记为 `logic-done-pending`，不宣称 done。
- [禁写死环境] → timeout 从函数参数读取，测试仅用场景输入，不新增生产环境常量。
- [凭据安全] → 本任务无凭据输入，测试与日志不含 secret。

## 未覆盖真实链路清单

- 真 Postgres decision log → loop.js → validation clock 写回：本 attempt `postgres=false`，交 brain-integration 环境补位；当前 `logic-done-pending`。
