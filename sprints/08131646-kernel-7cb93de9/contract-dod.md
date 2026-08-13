---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: fix loop 反馈断链（judge FAIL 裁决注入下轮 evaluator TaskBundle）

**范围**: `packages/brain/src/orchestrator/dispatcher.js` 的 `buildInputs` 在 `role=evaluator` 分支注入 `inputs.judge_feedback`（读 `observed.judgeVerdict` 最近一次 FAIL，summary+failure_class+round，脱敏+截断）；`packages/workflows/skills/harness-evaluator/SKILL.md` 消费侧指引；配套 failing test 永久进 CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] TDD 回归测试文件存在且断言 judge_feedback 注入
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js','utf8');if(!c.includes('judge_feedback'))process.exit(1)"

- [ ] [ARTIFACT] evaluator SKILL.md 含 judge_feedback 消费侧指引（优先补齐点名证据）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback')||!c.includes('优先补齐'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] B-01: judge FAIL 裁决存在时 evaluator bundle 注入 judge_feedback（含 summary 与 failure_class）
  动作: 构造「本 run 已有 verdict:judge FAIL(evidence_insufficient)」的 observed，调用真实 `__test__.buildInputs('spawn:evaluator', ...)`
  预期观察: 产出的 inputs.judge_feedback.summary 含 judge 点名的缺失证据文本，failure_class === 'evidence_insufficient'，verdict === 'FAIL'，round 为正整数
  等待预算: 0s
  留证: /tmp/jf-b01.log（vitest 输出，含该 it 绿）
  Test: manual:bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "注入 judge_feedback 含 summary 与 failure_class" --reporter=basic 2>&1 | tee /tmp/jf-b01.log'

- [ ] [BEHAVIOR] [L2] B-02: 首轮（本 run 无 judge verdict）时 evaluator bundle 不含 judge_feedback，行为回退现状
  动作: 构造无 judgeVerdict 的 observed，调用真实 `__test__.buildInputs('spawn:evaluator', ...)`
  预期观察: 产出的 inputs 不含 judge_feedback 键（与现状逐字节一致）
  等待预算: 0s
  留证: /tmp/jf-b02.log
  Test: manual:bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "不含 judge_feedback" --reporter=basic 2>&1 | tee /tmp/jf-b02.log'

- [ ] [BEHAVIOR] [L2] B-03: 超长 judge summary 注入后截断且完整 bundle ≤ 256KB（传输闸回归）
  动作: 构造 judge feedback = 30 万字符的 observed，调用真实 buildInputs + buildBundle + enforceBundleSizeLimit
  预期观察: inputs.judge_feedback.summary.length ≤ 2000（sanitizeDiagnostic 截断），Buffer.byteLength(JSON.stringify(bundle)) ≤ 262144
  等待预算: 0s
  留证: /tmp/jf-b03.log
  Test: manual:bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "注入后被截断" --reporter=basic 2>&1 | tee /tmp/jf-b03.log'

- [ ] [BEHAVIOR] [L2] B-04: 非 evaluator 角色（judge）的 bundle 不注入 judge_feedback
  动作: 用同一含 judge FAIL 的 observed，调用真实 `__test__.buildInputs('spawn:judge', ...)`
  预期观察: judge 角色产出的 inputs 不含 judge_feedback 键（注入仅限 evaluator 角色）
  等待预算: 0s
  留证: /tmp/jf-b04.log
  Test: manual:bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "非 evaluator 角色" --reporter=basic 2>&1 | tee /tmp/jf-b04.log'

- [ ] [BEHAVIOR] [L2] B-05: 同 run 多条 judge verdict 只注入最近一次，summary 脱敏、round 记为最新轮次
  动作: 构造 decisionLog 含两条 verdict:judge 且最新 feedback 带 token=secret 的 observed，调用真实 buildInputs('spawn:evaluator', ...)
  预期观察: inputs.judge_feedback.summary 不含明文 'secret-xyz'（sanitizeDiagnostic 脱敏），round === 2（judge 行计数=最新轮次）
  等待预算: 0s
  留证: /tmp/jf-b05.log
  Test: manual:bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "只注入最近一次" --reporter=basic 2>&1 | tee /tmp/jf-b05.log'

- [ ] [BEHAVIOR] INV-3 [L2] 回归护栏：既有 dispatcher orchestrator 单测不被本改动打破
  动作: 运行既有 dispatcher.test.js 全量单测
  预期观察: 全量绿，无 failed（judge_feedback 注入不破坏既有 evaluator/generator bundle 组装）
  等待预算: 0s
  留证: /tmp/jf-inv3.log（含 "passed" 且无 "failed"）
  Test: manual:bash -c 'cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=basic 2>&1 | tee /tmp/jf-inv3.log | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! grep -qE "[0-9]+ failed" /tmp/jf-inv3.log'
