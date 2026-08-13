---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: fix loop 反馈断链——judge FAIL 裁决注入下轮 evaluator TaskBundle

**范围**: `packages/brain/src/orchestrator/dispatcher.js` `buildInputs` role=evaluator 分支新增 `judge_feedback` 注入（读最近 judge FAIL verdict + 脱敏 + 截断）；常驻回归测试入 brain-ci；evaluator SKILL 快照消费侧同步。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 常驻回归测试入库 brain-ci 路径且含 6 条子测试
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js','utf8');if(!c.includes('judge_feedback')||(c.match(/\bit\(/g)||[]).length<6)process.exit(1)"

- [ ] [ARTIFACT] dispatcher.js 含 judge_feedback 注入逻辑（读 verdict:judge FAIL + sanitizeDiagnostic 截断）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!c.includes('judge_feedback')||!c.includes('verdict:judge')||!c.includes('sanitizeDiagnostic'))process.exit(1)"

- [ ] [ARTIFACT] evaluator SKILL 快照消费侧新增 judge_feedback 优先补齐点名证据指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback')||!/优先补齐|点名.*证据/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: run 存在 judge FAIL verdict 时注入 judge_feedback 含 summary 与 failure_class 与轮次
  动作: 构造 observed.decisionLog 含一条 verdict:judge FAIL（failure_class=evidence_insufficient, feedback=点名缺失证据），dispatch spawn:evaluator
  预期观察: bundle.inputs.judge_feedback 精确等于 {hop:5, verdict:'FAIL', failure_class:'evidence_insufficient', summary:'缺少失败路径直接执行的 stdout 与退出码'}
  等待预算: 0s
  留证: vitest 子测试输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "run 存在 judge FAIL verdict 时注入" 2>&1 | tee /tmp/b01.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b01.log || exit 1'

- [ ] [BEHAVIOR] [L2] B-02: 无 judge verdict（首轮 evaluator）时不注入 judge_feedback 字段
  动作: 构造 observed.decisionLog=[]，dispatch spawn:evaluator
  预期观察: bundle.inputs 无 judge_feedback 属性（not.toHaveProperty）
  等待预算: 0s
  留证: vitest 子测试输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "不注入 judge_feedback 字段" 2>&1 | tee /tmp/b02.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b02.log || exit 1'

- [ ] [BEHAVIOR] [L2] B-03: 同 run 多条 judge FAIL 时只注入 hop 最大的最近一次
  动作: 构造 decisionLog 含 hop=3 与 hop=9 两条 judge FAIL，dispatch spawn:evaluator
  预期观察: judge_feedback.hop==9 且 summary/failure_class 取自 hop=9 那条
  等待预算: 0s
  留证: vitest 子测试输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "只注入 hop 最大的最近一次" 2>&1 | tee /tmp/b03.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b03.log || exit 1'

- [ ] [BEHAVIOR] [L2] B-04: 超长 judge summary 截断后 bundle 不越 256KB 传输闸
  动作: 构造 feedback=500000 字符的 judge FAIL，dispatch spawn:evaluator
  预期观察: judge_feedback.summary.length ≤ 2000 且 Buffer.byteLength(JSON.stringify(bundle)) < 262144
  等待预算: 0s
  留证: vitest 子测试输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "超长 judge summary 截断后 bundle 不越 256KB" 2>&1 | tee /tmp/b04.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b04.log || exit 1'

- [ ] [BEHAVIOR] [L2] INV-judge-fail-triage: judge FAIL 但 failure_class 非 evidence 类仍注入（消费侧区分证据截断 vs 实现缺陷）
  动作: 构造 judge FAIL failure_class=product_failure，dispatch spawn:evaluator
  预期观察: judge_feedback.verdict=='FAIL' 且 judge_feedback.failure_class=='product_failure'（原样携带供区分）
  等待预算: 0s
  留证: vitest 子测试输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "failure_class 非 evidence 类仍注入" 2>&1 | tee /tmp/b05.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b05.log || exit 1'

- [ ] [BEHAVIOR] [L2] B-06: judge 判 PASS 时不注入 judge_feedback
  动作: 构造 decisionLog 含 verdict:judge PASS，dispatch spawn:evaluator
  预期观察: bundle.inputs 无 judge_feedback 属性
  等待预算: 0s
  留证: vitest 子测试输出末 5 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "judge 判 PASS 时不注入" 2>&1 | tee /tmp/b06.log | tail -5; grep -qE "Tests[[:space:]]+1 passed" /tmp/b06.log || exit 1'

- [ ] [BEHAVIOR] [L2] B-07: 全部 6 条常驻回归子测试在 PR 分支全绿（brain-ci 常驻回归）
  动作: 对 PR 分支跑整个 dispatcher-judge-feedback.test.js
  预期观察: Tests 6 passed (6)，无 failed
  等待预算: 0s
  留证: vitest 全文件输出末 10 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js 2>&1 | tee /tmp/b07.log | tail -10; grep -qE "Tests[[:space:]]+6 passed \(6\)" /tmp/b07.log && ! grep -qE "[0-9]+ failed" /tmp/b07.log || exit 1'
