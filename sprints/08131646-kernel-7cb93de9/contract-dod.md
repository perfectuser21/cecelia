---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: fix loop judge FAIL 裁决注入下轮 evaluator TaskBundle

**范围**: `packages/brain/src/orchestrator/dispatcher.js` `buildInputs` evaluator 分支注入 `inputs.judge_feedback`（读 `observed.judgeVerdict`）；永久回归单测；evaluator skill 消费侧提示词。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 永久回归单测文件存在于 CI 路径（brain-ci 覆盖），含 judge_feedback 注入断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js','utf8');if(!c.includes('judge_feedback')||!c.includes('buildInputs'))process.exit(1)"

- [ ] [ARTIFACT] dispatcher.js buildInputs evaluator 分支读取 observed.judgeVerdict 注入 judge_feedback
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!c.includes('judge_feedback')||!c.includes('judgeVerdict'))process.exit(1)"

- [ ] [ARTIFACT] evaluator skill 消费侧提示词：含 judge_feedback 时优先补齐 judge 点名缺失证据（SKILL.md 快照，按 scripts/sync-skills-snapshot.sh 流程回补真身 SSOT）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback')||!(c.includes('优先补齐')||c.includes('优先补取')))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令；autonomous / local_api，postgres=false → vitest+node 体检，无 psql/curl）

- [ ] [BEHAVIOR] [L2] B-01: 同 run 存在 judge FAIL 时 buildInputs(evaluator) 注入 judge_feedback（含 summary 与 failure_class；INV-1：failure_class 原样带 evidence_insufficient）
  动作: 构造 observed.judgeVerdict.verdict='FAIL'/failure_class='evidence_insufficient'/feedback 点名缺失证据，调 buildInputs('spawn:evaluator',...)
  预期观察: inputs.judge_feedback.summary 含点名缺失证据文本、failure_class==='evidence_insufficient'、round===1
  等待预算: 0s
  留证: vitest 输出末 5 行（含该用例 PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "同 run 存在 judge FAIL"'

- [ ] [BEHAVIOR] [L2] B-02: 本 run 无任何 judge verdict 时不注入 judge_feedback 字段（字段缺席，非空对象）
  动作: 构造 observed.judgeVerdict=null / decisionLog 无 verdict:judge 行，调 buildInputs('spawn:evaluator',...)
  预期观察: inputs 不含 judge_feedback 属性
  等待预算: 0s
  留证: vitest 输出末 5 行（含该用例 PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "无任何 judge verdict"'

- [ ] [BEHAVIOR] [L2] B-03: 最近 judge verdict 为 PASS 时不注入 judge_feedback 字段
  动作: 构造 observed.judgeVerdict.verdict='PASS'，调 buildInputs('spawn:evaluator',...)
  预期观察: inputs 不含 judge_feedback 属性
  等待预算: 0s
  留证: vitest 输出末 5 行（含该用例 PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "PASS 时不注入"'

- [ ] [BEHAVIOR] [L2] B-04: 超长 judge summary 截断后整包 TaskBundle 不越过 256KB 传输闸
  动作: 构造 feedback='x'×1e6 的 judge FAIL，调 buildInputs + buildBundle + enforceBundleSizeLimit
  预期观察: judge_feedback.summary 长度 ≤2000；enforceBundleSizeLimit 不抛；JSON 整包字节 ≤ HARNESS_BUNDLE_MAX_BYTES(256KB)
  等待预算: 0s
  留证: vitest 输出末 5 行（含该用例 PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "256KB"'

## Invariant 覆盖（铁律逐条映射）

- INV-1 [证据分类]（由 B-01 覆盖）: judge FAIL `evidence_insufficient` → `judge_feedback.failure_class` 原样带 `evidence_insufficient`，让 evaluator 走补取证路径。B-01 断言 failure_class==='evidence_insufficient'。
- INV-2 [证据窗口]（N/A）: judge 证据消费窗口（前 8×600）与 evaluator `.brain-result.json` 一手证据口径本 sprint 不触及（PRD 范围外明确排除），无回退。
- INV-3 [验证时钟]（N/A）: evaluator 复用既有 PR 验证时钟；本 sprint 不改 `buildInputs` 的 `pipeline_started_at/deadline_at` 注入逻辑（新增分支为 additive，不动 validation_clock）。

## 回归护栏

- 既有 `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` 必须继续全绿（新增 judge_feedback 字段为 additive，不得破坏 GP contract 注入 / 批准后 PRD 去重 / required_command_evidence 只读复制等既有断言）。
