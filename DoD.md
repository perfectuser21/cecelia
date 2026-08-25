contract_branch: cp-harness-propose-r1-9c835025-rda98a76a-a34
sprint_dir: sprints/08250940-kernel-r71-validation-clock

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel validation clock 按 fix 轮自动顺延（有界）[r71]

**范围**: 仅改 `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`：decisionLog 含 `spawn:generator-fix` 时原点顺延到最后一次（有界第 6 次）fix 行 created_at；无 fix 轮语义不变。不改 `timeout_seconds` 默认值、不动人审 deadline 分支、不动 `persistedClock` malformed 校验。冻结测试落 `sprints/<sprint_dir>/tests/` 与 `tests/gp/f1/`（真 import 被改文件，禁 mock 被改的边）。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] validation-clock.js 落地 fix 轮顺延分支（含 spawn:generator-fix 过滤 + 有界常量 6）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/spawn:generator-fix/.test(c)||!/\b6\b/.test(c))process.exit(1)"

- [x] [ARTIFACT] sprint 冻结合同测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts','utf8');if(!c.includes('validation-clock.js')||!c.includes('resolveValidationClock'))process.exit(1)"

- [x] [ARTIFACT] F1 gp/f1 冻结测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/tests/gp/f1/step3-validation-clock-fix-round-extend.test.js','utf8');if(!c.includes('validation-clock.js')||!c.includes('resolveValidationClock'))process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [x] [BEHAVIOR] [L2] B-01: 复刻 r50 场景多次 fix 后原点顺延到最后一次 fix（旧判死→新存活）
  动作: 从仓库根真跑 tests/gp/f1/step3-validation-clock-fix-round-extend.test.js（真 import validation-clock.js，传含 3 个 spawn:generator-fix 行的真实 decisionLog）
  预期观察: resolveValidationClock 对 spawn:evaluator/judge/generator-fix 均返回 pipeline_started_at=最后 fix(04:00)、deadline_at=05:30（非旧 generator 原点 00:00/01:30），8 条全绿
  等待预算: 0s
  留证: vitest 输出末 5 行（含 Tests 8 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-validation-clock-fix-round-extend.test.js --no-cache --reporter=dot'

- [x] [BEHAVIOR] [L2] B-02: 顺延有界——满 6 次后原点冻结第 6 次 fix，第 7 次不再顺延照常判死
  动作: 真跑 gp/f1 冻结测试中「有界 顺延满6次后照常判死」用例（decisionLog 含 7 个整点 fix）
  预期观察: pipeline_started_at=第 6 次 fix(06:00)、deadline_at=07:30，第 7 次 fix(07:00) 不成为原点，用例绿
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-validation-clock-fix-round-extend.test.js -t "有界 顺延满6次后照常判死" --no-cache --reporter=dot'

- [x] [BEHAVIOR] [L2] B-03: 纯函数可重放——fix 行乱序/重复 hop 以 hop 升序取最后合法 fix
  动作: 真跑 gp/f1 冻结测试中「纯函数可重放」用例（同输入不同数组顺序）
  预期观察: 打乱 decisionLog 数组顺序，resolveValidationClock 结果一致（原点=hop 最大的 fix=04:00），用例绿
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-validation-clock-fix-round-extend.test.js -t "纯函数可重放" --no-cache --reporter=dot'

- [x] [BEHAVIOR] [L2] B-04: sprint 冻结合同测试全绿（replay 顺延 + 有界 + 无 fix 回归）
  动作: 从仓库根真跑 sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts
  预期观察: 3 条用例全绿（复刻 r50 顺延存活 / 顺延有界满 6 判死 / 无 fix 轮语义不变原点=首个 generator）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 Tests 3 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts --no-cache --reporter=dot'

- [x] [BEHAVIOR] [L2] B-05: 无 fix 轮语义不变——既有 11 条 brain 单测不回归
  动作: 子 shell 切进 packages/brain 用包内 vitest 配置真跑 src/orchestrator/__tests__/validation-clock.test.js
  预期观察: 既有 11 条断言全过（首个 generator 共享窗口 / 持久化 clock 复用 / malformed fail-closed / authoring 返回 null），退出码 0，无回归
  等待预算: 0s
  留证: vitest 输出末 5 行（含 Tests 11 passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=dot'
