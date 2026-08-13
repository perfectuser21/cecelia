---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: fix loop 反馈断链 judge FAIL 裁决注入下轮 evaluator TaskBundle

**范围**: `packages/brain/src/orchestrator/dispatcher.js` 的 `buildInputs`（evaluator 分支）新增 `judge_feedback` 注入 + `constants.js` 截断上限 + `harness-evaluator/SKILL.md` 消费侧提示词 + permanent 回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] dispatcher.js buildInputs evaluator 分支注入 judge_feedback（读最近 verdict:judge FAIL）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!c.includes('judge_feedback')||!c.includes('verdict:judge'))process.exit(1)"

- [ ] [ARTIFACT] constants.js 定义 summary 截断上限常量（4000 字符）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/constants.js','utf8');if(!/JUDGE_FEEDBACK_SUMMARY_MAX_CHARS/.test(c))process.exit(1)"

- [ ] [ARTIFACT] permanent 回归测试落在 brain-unit CI include glob 内（src/orchestrator/*.test.js，无 DB）
  Test: node -e "const fs=require('fs');const p='packages/brain/src/orchestrator/dispatcher-judge-feedback.test.js';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('judge_feedback')||!c.includes('buildInputs'))process.exit(1)"

- [ ] [ARTIFACT] harness-evaluator SKILL.md 消费侧提示词：含 judge_feedback 时优先补齐点名缺失证据（SSOT，snapshot 按流程 sync）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback'))process.exit(1)"

## Invariant 覆盖条目

- [ ] [BEHAVIOR] [L2] INV-1 证据分类：evidence_insufficient 的 judge FAIL 产出补证输入（judge_feedback），非改判逻辑
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b01'
  期望: OK
- INV-2（N/A）证据前置窗口（前 8 条 × 600 字符）不改动：本单只提供 judge_feedback 输入，不触碰 judge 证据消费窗口，消费侧仅改 SKILL.md 提示词（无窗口代码改动），无可执行断言。
- [ ] [BEHAVIOR] [L2] INV-3 验证命令实跑 exit code 语义：BEHAVIOR 全用 node 直跑真实函数，不吃 vitest include 绿态
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b02'
  期望: OK

## BEHAVIOR 条目（五行剧本，node 直跑真实 buildInputs — L2 服务端真验，无 DB）

- [ ] [BEHAVIOR] [L2] B-01: judge FAIL → buildInputs(evaluator) 注入 judge_feedback（summary+failure_class+round）
  动作: 构造 run 含一条 verdict:judge FAIL(evidence_insufficient, hop=5, feedback 点名缺失证据)，调 buildInputs(role=evaluator)
  预期观察: inputs.judge_feedback 存在，summary 含点名证据("ffprobe")，failure_class==='evidence_insufficient'，round===5
  等待预算: 0s
  留证: node oracle stdout（OK 行）→ behavior_tests.log_tail
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b01'

- [ ] [BEHAVIOR] [L2] B-02: 无 judge verdict → 不注入 judge_feedback（bundle 结构与现状一致）
  动作: 构造 run 的 decisionLog 为空，调 buildInputs(role=evaluator)
  预期观察: 'judge_feedback' in inputs === false
  等待预算: 0s
  留证: node oracle stdout（OK 行）
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b02'

- [ ] [BEHAVIOR] [L2] B-03: 最近 judge 裁决 PASS → 不注入 judge_feedback（边界）
  动作: 构造 run 最近一条 verdict:judge 为 PASS，调 buildInputs(role=evaluator)
  预期观察: 'judge_feedback' in inputs === false
  等待预算: 0s
  留证: node oracle stdout（OK 行）
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b03'

- [ ] [BEHAVIOR] [L2] B-04: 600KB 超长 summary → 截断且整条 bundle ≤ 256KB（回归传输闸）
  动作: 构造 judge FAIL 的 feedback 为 600KB，调 buildBundle+enforceBundleSizeLimit(role=evaluator)
  预期观察: Buffer.byteLength(JSON.stringify(bundle)) ≤ 262144 且 judge_feedback.summary.length ≤ 4096
  等待预算: 0s
  留证: node oracle stdout（bytes<=262144, summary 截断字符数）
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b04'

- [ ] [BEHAVIOR] [L2] B-05: summary 含凭据(ghp_...) → 落 bundle 前脱敏为 [REDACTED]（NFR 脱敏）
  动作: 构造 judge FAIL 的 feedback 含 ghp_ 凭据串，调 buildInputs(role=evaluator)
  预期观察: judge_feedback.summary 不含原始凭据串，含 [REDACTED] 标记
  等待预算: 0s
  留证: node oracle stdout（OK 行）
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b05'

- [ ] [BEHAVIOR] [L2] B-06: 多条 judge FAIL → 只注入最近一次（按 hop 倒序），round 为最新 hop（边界）
  动作: 构造三条 verdict:judge FAIL(hop 3/5/7)，调 buildInputs(role=evaluator)
  预期观察: judge_feedback.round===7，failure_class 与 summary 均来自 hop=7 的最新裁决
  等待预算: 0s
  留证: node oracle stdout（OK 行）
  Test: manual:bash -c 'node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b06'
