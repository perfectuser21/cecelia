---
skeleton: false
journey_type: autonomous
---
# Contract DoD — validation clock 按 fix 轮有界顺延

**范围**: 仅 `resolveValidationClock` pipeline origin 选择与所需版本同步
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/orchestrator/validation-clock.js` 实现至多六次 fix 顺延，`packages/brain/DEFINITION.md` 完成版本同步。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/validation-clock.js','packages/brain/DEFINITION.md'])fs.accessSync(p)"
- [ ] [ARTIFACT] 两份 RED 冻结测试永久保留并真实 import 被改模块。
  Test: node -e "const fs=require('fs');for(const p of ['sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts','tests/gp/f1/validation-clock-fix-extension.test.js']){const s=fs.readFileSync(p,'utf8');if(!s.includes('packages/brain/src/orchestrator/validation-clock.js')||/vi\.mock|jest\.mock/.test(s))process.exit(1)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: r50 型场景在成功 fix 新窗口内保持存活
  动作: 真实导入 `resolveValidationClock`，重放首次 generator 与一次较晚 generator-fix 日志
  预期观察: 返回原点切换到 fix 行，deadline 从该原点重新计算
  等待预算: 5s
  留证: Vitest 失败或通过日志中的 expected/received deadline
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "r50 型场景旧 deadline 已过但最新成功 fix 窗口仍存活"'

- [ ] [BEHAVIOR] [L2] B-02: 第六次成功 fix 仍允许顺延
  动作: 按 hop 重放首次 generator 与六次 generator-fix
  预期观察: 返回第六次 fix 原点及其 5400 秒 deadline
  等待预算: 5s
  留证: Vitest 精确对象比较输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第六次成功 fix 仍以第六次 fix 原点顺延"'

- [ ] [BEHAVIOR] [L2] B-03: 第七次 fix 超限不再续期
  动作: 倒序提供首次 generator 与七次 generator-fix 日志后执行纯函数重放
  预期观察: 有效原点停在第六次，第七次不改变 deadline
  等待预算: 5s
  留证: Vitest 精确对象比较与乱序重放输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts -t "第七次成功 fix 超限且不得把原点延到第七次"'

- [ ] [BEHAVIOR] [L2] B-04: 无 fix 轮保持既有计时语义
  动作: 仅提供首次 generator 日志并执行真实纯函数
  预期观察: 原点与 deadline 和变更前完全一致
  等待预算: 5s
  留证: Vitest 精确 deadline 输出
  Test: manual:bash -c 'npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t "无 fix 轮仍使用首次 generator 原点"'

## Invariant 映射

- [重派语义] N/A：本 sprint 不修改 derive/dispatcher 的重派动作选择。
- [分支权威] N/A：本 sprint 不修改 workspace 或 planner branch。
- [验证时钟] 由 B-01 至 B-04 保持 fail-closed 正常时钟，不加旁路。
- [时间不变量] 由 B-02/B-03 验证 `deadline = 有效原点 + timeoutSeconds` 且顺延次数 `<= 6`。
- [真实边界] 由 ARTIFACT 2 与全部 B 条目真实 import，禁止 mock 被改边。
- [接缝真验] loop.js 真库接缝已登记为 `logic-done-pending`。
- [串行会话] N/A：不修改 slot/session 调度。
- [秘密保护] N/A：测试使用固定非敏感时间值，不读取或输出 secret。

## 未覆盖真实链路清单

- `loop.js ↔ 真 Postgres orchestrator_decision_log`：本 attempt 无 Postgres；由 Generator PR 的 `brain-integration` job 补位，验过前 `logic-done-pending`。
