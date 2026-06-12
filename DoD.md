---
sprint_dir: sprints/06121644-judge-deepseek
---
# DoD — 独立验收裁判（DeepSeek via ToAPIs）judge-rework

**范围**: `packages/brain/src/harness-judge.js`（裁判模块），`packages/brain/src/workflows/harness-task.graph.js`（evaluateContractNode 接入裁判门），`scripts/ops/sync-credentials.sh`（ToAPIs notesPlain 解析），`packages/engine/src/harness/{e2e-judge,evaluate,runner}.js`（传输换 toapis + 工具库归位 + 去 EVAL_LEGACY），`packages/brain/src/__tests__/harness-judge.test.js`（单测），`packages/brain/scripts/smoke/harness-judge-smoke.sh`（smoke）
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/harness-judge.js` 存在，导出 `runJudgeGate`、`callDeepSeekJudge`、`validateCoverage`、`parseGoldenPathSteps`，模型 deepseek-v4-flash 且读 message.content 忽略 reasoning_content
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-judge.js','utf8');for(const s of ['runJudgeGate','callDeepSeekJudge','validateCoverage','parseGoldenPathSteps','deepseek-v4-flash','reasoning_content'])if(!c.includes(s))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `evaluateContractNode` 接入独立裁判门：harness-task.graph.js import 并经 finalizeEvaluation 调用 runJudgeGate
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('harness-judge.js'))process.exit(1);if(!c.includes('finalizeEvaluation'))process.exit(1);if(!c.includes('runJudgeGate'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `scripts/ops/sync-credentials.sh` 含 sync_notes 解析 ToAPIs notesPlain（生成合法 toapis.env）
  Test: node -e "const c=require('fs').readFileSync('scripts/ops/sync-credentials.sh','utf8');if(!c.includes('sync_notes'))process.exit(1);if(!c.includes('ToAPIs'))process.exit(1);if(!c.includes('NOTES'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/src/harness/e2e-judge.js` 传输层换 ToAPIs DeepSeek（去 Anthropic 直连）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/e2e-judge.js','utf8');if(!c.includes('callDeepSeekLLM'))process.exit(1);if(!c.includes('chat/completions'))process.exit(1);if(c.includes('api.anthropic.com'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/src/harness/evaluate.js` 去除「移交执行权」回退开关接线（isLegacyMode / use_legacy_eval 判定）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/evaluate.js','utf8');if(c.includes('isLegacyMode'))process.exit(1);if(c.includes('use_legacy_eval'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/src/harness/runner.js` 标注「可选的脚本化执行记录器，不替代 agent 执行」
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/runner.js','utf8');if(!c.includes('不替代'))process.exit(1);if(!c.includes('可选'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 三权分立裁判门：agent PASS + 裁判 FAIL/覆盖缺步 → 终判 FAIL（裁判优先）；裁判网络错 fail-open 保留 agent verdict；JUDGE_STRICT fail-closed；agent FAIL 不调裁判
  Test: manual:node sprints/06121644-judge-deepseek/behaviors/b1-judge-gate.mjs
  期望: OK
