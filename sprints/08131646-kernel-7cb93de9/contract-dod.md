---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: fix loop 反馈断链 judge FAIL 裁决注入下轮 evaluator TaskBundle

**范围**: `packages/brain/src/orchestrator/dispatcher.js` evaluator 分支新增 `judge_feedback` 注入（读本 run 最近 `verdict:judge` FAIL）；`sanitizeDiagnostic` 脱敏截断；evaluator SKILL.md 消费侧提示词；先写 failing 单测再修，永久进 brain-unit CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] dispatcher.js evaluator 分支注入 judge_feedback（新增 buildJudgeFeedback 且在 spec.role==='evaluator' 分支挂载）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!/buildJudgeFeedback/.test(c)||!/judge_feedback/.test(c))process.exit(1)"

- [ ] [ARTIFACT] judge_feedback 回归单测永久落 brain-unit CI（写入 __tests__/dispatcher.test.js，非仅 sprint 目录）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher.test.js','utf8');if(!/judge_feedback/.test(c))process.exit(1)"

- [ ] [ARTIFACT] evaluator SKILL.md 新增 judge_feedback 消费段（含「优先补齐点名证据」语义）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!/judge_feedback/.test(c)||!/优先补齐|点名/.test(c))process.exit(1)"

## Invariant 覆盖（PRD 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [证据补齐优先] evidence_insufficient 的 failure_class 原样随 judge_feedback 注入
  动作: 构造 observed.decisionLog 含一条 verdict:judge FAIL 行（failure_class='evidence_insufficient'，feedback 点名缺失证据），调 buildInputs(role=evaluator)
  预期观察: inputs.judge_feedback.failure_class === 'evidence_insufficient'，evaluator 可据此走「补证据」而非重跑
  等待预算: 0s
  留证: vitest --reporter=dot 输出（含该 it 通过行）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: evidence_insufficient failure_class 原样注入" --reporter=dot'

- INV-2 [证据消费窗口] N/A：本 sprint 不改 evaluator 产 .brain-result.json 的证据排布，也不改 judge 前8条×600字符消费窗口；judge_feedback 是注入给 evaluator 的输入，与 judge 读证据窗口无耦合。
- INV-3 [local_api 免死锁] N/A（合同层规避）：本 sprint 验收全部走 vitest 逻辑单测（buildInputs 纯函数），不要求任何 UI smoke / meta_verification 产物，target_environment=local_api 但无 judge 机械闸⑤ 死锁面。

## BEHAVIOR 条目（内嵌可执行 manual: 命令，target_environment=local_api / autonomous）

- [ ] [BEHAVIOR] [L2] B-01: 存在 judge FAIL verdict 时注入 summary/failure_class/round
  动作: 构造 observed.decisionLog 含一条 verdict:judge FAIL 行，调 buildInputs('spawn:evaluator', {role:'evaluator'}, ...)
  预期观察: inputs.judge_feedback 存在，含 summary(=脱敏后 feedback)、failure_class、round(=该行 hop) 三键
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: 存在 judge FAIL verdict 时注入 summary/failure_class/round" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 无 judge verdict 时不注入该字段（保持首轮现状）
  动作: 构造 observed.decisionLog 无任何 verdict:judge 行（或为空/缺失），调 buildInputs(role=evaluator)
  预期观察: inputs 对象不含 judge_feedback 键（hasOwnProperty 为 false，非 null/空对象）
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: 无 judge verdict 时不注入该字段" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: 最近一次 judge verdict 为 PASS 时不注入
  动作: 构造 observed.decisionLog 最大 hop 的 verdict:judge 行 detail.verdict='PASS'（更早有 FAIL 行），调 buildInputs(role=evaluator)
  预期观察: inputs 不含 judge_feedback 键（最近一次为 PASS，无需反馈）
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: 最近 judge verdict 为 PASS 时不注入" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 多条 judge verdict 只取最近一次（最大 hop）
  动作: 构造 observed.decisionLog 含多条 verdict:judge FAIL 行（hop=5 feedback='旧', hop=9 feedback='新'），调 buildInputs(role=evaluator)
  预期观察: inputs.judge_feedback.summary 来自 hop=9 那条('新')且 round===9，不做历史累积/合并
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: 多条 judge verdict 只取最近一次" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 超长 summary 截断后整包不超 256KB
  动作: 构造 detail.feedback 为 200KB 超长字符串的 verdict:judge FAIL 行，调 buildInputs(role=evaluator)
  预期观察: judge_feedback.summary 被 sanitizeDiagnostic 截断至 ≤2000 字符，且 Buffer.byteLength(JSON.stringify(inputs)) ≤ 256*1024
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: 超长 summary 截断后整包不超 256KB" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: summary 注入前脱敏（Bearer/密钥不落明文）
  动作: 构造 detail.feedback 含 'Bearer secret-abc' 与 'token=hunter2' 的 verdict:judge FAIL 行，调 buildInputs(role=evaluator)
  预期观察: judge_feedback.summary 中不含 'secret-abc'/'hunter2' 明文（被 [REDACTED] 替换）
  等待预算: 0s
  留证: vitest --reporter=dot 输出该 it 通过行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "judge_feedback: summary 注入前脱敏" --reporter=dot'
