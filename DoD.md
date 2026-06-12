---
sprint_dir: sprints/06122058-judge-evidence
---
# DoD — 裁判证据供给 + evaluate 重入幂等（#3372 配套缺口）

**范围**: `packages/brain/src/harness-judge.js`（证据收集纳入 agent 完整 stdout + prompt 接受命令证据），`packages/brain/src/workflows/harness-task.graph.js`（finalizeEvaluation 透传 promptDir/taskId；evaluate 重入活容器复用幂等门 + findLiveEvaluateContainerDefault），`packages/brain/src/docker-executor.js`（getHostPromptDir 导出），`packages/brain/src/__tests__/harness-judge.test.js` + `packages/brain/src/workflows/__tests__/harness-evaluate-reentry-idem.test.js`（单测）
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `harness-judge.js` 导出 `resolveStdoutFile` / `extractAgentTranscript`，collectEvidence 返回 `agentStdout`，buildJudgePrompt 含 agentStdout 段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-judge.js','utf8');for(const s of ['resolveStdoutFile','extractAgentTranscript','agentStdout','AGENT_STDOUT_CAP'])if(!c.includes(s))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `harness-task.graph.js` 导出 `findLiveEvaluateContainerDefault` 并接入 evaluate 复用门，finalizeEvaluation 透传 promptDir/taskId
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');for(const s of ['findLiveEvaluateContainerDefault','reusedLiveContainer','getHostPromptDir','promptDir:'])if(!c.includes(s))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `docker-executor.js` 导出 `getHostPromptDir`（forensics stdout 目录 SSOT）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!c.includes('export function getHostPromptDir'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 证据供给：Brain 据 promptDir/taskId 读 evaluator 完整 stdout 转录（#3345 forensics）填入 agentStdout 交裁判；forensics 缺失 fail-open 退回 callback transcript；裁判 prompt 声明「含命令 stdout 即视为执行证据」且保留「证据缺失→FAIL」红线
  Test: manual:node sprints/06122058-judge-evidence/behaviors/b1-evidence-supply.mjs
  期望: OK

- [x] [BEHAVIOR] evaluate 重入幂等：findLiveEvaluateContainer 查同 (task, fix_round) 活容器，命中前缀 → 返回容器名供复用（跳过重 spawn），空/异前缀 → null（正常 spawn）
  Test: manual:node sprints/06122058-judge-evidence/behaviors/b2-reentry-idem.mjs
  期望: OK
