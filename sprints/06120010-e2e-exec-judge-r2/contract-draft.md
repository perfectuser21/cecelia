# Sprint Contract Draft (Round 5)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 为纯内部 `evaluateContractNode` 重构，新增两个纯工具函数并改造节点流程，不新增任何 REST 端点。Reviewer 第 6 维自动满分。

---

## 已知约束（来自回归测试）

- [harness-initiative-evaluate.test.js] → parsePrdNode — when parseTaskPlan throws, returns { taskPlan: null }
- [harness-initiative-evaluate.test.js] → inferTaskPlanNode — git show 失败时返回 { error }
- [harness-initiative-evaluate.test.js] → pickSubTaskNode — resets task_loop_fix_count to 0 on each pick
- [harness-initiative-evaluate.test.js] → retryTaskNode — keeps evaluate_feedback for use by run_sub_task
- [harness-initiative-evaluate.test.js] → _routeAfterFinalE2E — 4 cases (error / PASS / PASS_WITH_OVERRIDE / FAIL)
- [docker-executor-metadata.test.js] → cidFilePath 唯一化（runInstance 后缀，不可预测）
- [harness-contract-branch-recovery.test.ts] → contractBranch recovery
- [harness-artifact-gate.test.js] → verifyContractArtifactsForPr 行为

---

## Risks（R2 新增 — 上轮风险登记缺失，Reviewer 阻塞 [1]）

### Risk 1: #3345 命名协议实现完整性未验证

**级别**: P2
**描述**: PRD ASSUMPTION "沿用现有 docker-executor.js 机制" 未经验证。`#3345` 取证命名协议在 `docker-executor-metadata.test.js` 中以单测保障，但当前 `harness-final-e2e.js` 的 `runScenarioCommand` 是否已接入 `#3345` 唯一命名逻辑（8-hex runInstance 后缀）未经回归确认。若协议接口不匹配，执行记录文件名冲突、历史记录被覆盖。
**Mitigation**:
- 合同 Step 7 "取证唯一命名"验证命令要求两次调用产生不同 `recordPath`，generator 实现时必须满足此断言（自动在 CI 暴露冲突）
- ARTIFACT Test 命令中加入文件名格式检查（含 `runId` 片段）

### Risk 2: stdout/stderr 截断阈值未定义导致 LLM 裁读成本超预期

**级别**: P2
**描述**: PRD ASSUMPTION "LLM 裁读调用成本目标 < $2/轮，通过精简 prompt（仅输入执行记录摘要而非完整 stdout）实现"，但截断阈值（字节上限）未在任何接口约束中定义。若 generator 不做截断，E2E 执行记录原文全量进 prompt，单轮裁读 token 可超 10 万，超 $2 目标 5-10 倍。
**Mitigation**:
- 合同 Step 2 "执行记录落盘" `executeContractCommands` 接口定义中规定：stdout/stderr 各截断至 ≤ 4000 字节（保留头 3000 + 尾 1000），与现有 `runScenarioCommand` 的 `OUTPUT_CAP_BYTES=4000` 对齐
- 合同 BEHAVIOR 第 9 项（截断场景专项测试）：生成 > 4000 字节输出（TRNK_HEAD + 5000×A + TRNK_TAIL，exit 9），验证 stdout.length ≤ 4000、头部 TRNK_HEAD 保留、尾部 TRNK_TAIL 保留，且 exit_code=9 正确捕获（不因截断丢失）

---

## Golden Path

[evaluateContractNode 入口] → [代码执行 E2E + 捕获记录] → [执行记录落盘] → [LLM 裁读记录] → [覆盖校验] → [verdict + coverage 写盘] → [节点返回终态]

---

### Step 1: 代码执行层接管 E2E 命令运行（通过型）

**来源**: `[FROM_PRD]` — PRD "代码（非 LLM）在 runner 容器内执行脚本，逐命令捕获 exit code / stdout / stderr（截断可控）/ 耗时"

**可观测行为**: `evaluateContractNode` 调用新增的 `executeContractCommands` 函数（非 LLM spawn），逐命令执行 contract-dod.md 的 BEHAVIOR `manual:bash` 命令，返回结构化执行记录数组。

**验证命令**:
```bash
node --input-type=module -e "
import('./packages/brain/src/harness-final-e2e.js').then(m => {
  if (typeof m.executeContractCommands !== 'function') {
    throw new Error('executeContractCommands 未从 harness-final-e2e.js 导出');
  }
  console.log('OK');
}).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });"
```

**硬阈值**: 函数导出存在，exit 0

---

### Step 2: 执行记录按命令结构落盘（遵循 #3345 命名协议）

**来源**: `[FROM_PRD]` — PRD "落盘结构化执行记录文件（遵循 #3345 命名协议）"

**可观测行为**: 执行后在 `$SPRINT_DIR/` 下生成 `exec-record-{run_id}.json` 文件，内含 `commands` 数组，每元素含 `cmd / exit_code / stdout / stderr / duration_ms`。文件名含运行实例唯一后缀（防同一 task 重跑覆盖，对齐 #3345）。

**验证命令**:
```bash
node --input-type=module -e "
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync, mkdirSync, rmSync } from 'fs';
const dir = '/tmp/exec-record-test-verify';
mkdirSync(dir, { recursive: true });
try {
  const result = await executeContractCommands(
    [{cmd: 'echo hello-fixture', type: 'bash'}],
    { sprintDir: dir, runId: 'run-test-001' }
  );
  if (!result.recordPath) throw new Error('recordPath 未返回');
  const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
  if (!Array.isArray(record.commands)) throw new Error('commands 不是数组');
  const c = record.commands[0];
  if (typeof c.exit_code !== 'number') throw new Error('缺 exit_code');
  if (typeof c.duration_ms !== 'number') throw new Error('缺 duration_ms');
  if (typeof c.stdout !== 'string') throw new Error('缺 stdout');
  if (typeof c.stderr !== 'string') throw new Error('缺 stderr');
  if (!c.stdout.includes('hello-fixture')) throw new Error('stdout 未含预期输出');
  console.log('OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}"
```

**硬阈值**: 文件存在 + schema 字段完整 + stdout 含预期输出，exit 0

---

### Step 3: 失败命令 exit_code 捕获（失败型路径）

**来源**: `[FROM_PRD]` — PRD "失败型脚本 fixture → 执行记录捕获非零 exit + 失败 stdout/stderr 原文"

**可观测行为**: 包含失败命令（`exit 1` 或业务失败）的 fixture 运行后，执行记录中该命令的 `exit_code !== 0`，`stdout/stderr` 保留原始失败输出文本（不丢弃，不发明）。

**验证命令**:
```bash
node --input-type=module -e "
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync, mkdirSync, rmSync } from 'fs';
const dir = '/tmp/exec-fail-test-verify';
mkdirSync(dir, { recursive: true });
try {
  const result = await executeContractCommands(
    [
      {cmd: 'echo before-fail', type: 'bash'},
      {cmd: 'echo FAIL-MARKER >&2 && exit 42', type: 'bash'}
    ],
    { sprintDir: dir, runId: 'run-fail-001' }
  );
  const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
  const c1 = record.commands[0];
  const c2 = record.commands[1];
  if (c1.exit_code !== 0) throw new Error('echo 应 exit_code=0，得 ' + c1.exit_code);
  if (c2.exit_code === 0) throw new Error('失败命令 exit_code 应非 0，得 0');
  const combined = (c2.stdout || '') + (c2.stderr || '');
  if (!combined.includes('FAIL-MARKER')) throw new Error('失败原文未保留: ' + combined.slice(0, 200));
  console.log('OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}"
```

**硬阈值**: 失败命令 `exit_code !== 0`，`FAIL-MARKER` 出现在 stdout/stderr 原文中，exit 0

---

### Step 4: LLM 裁读 — 输出 coverage 对照表

**来源**: `[FROM_PRD]` — PRD "送入轻量 LLM 裁读 → 输出 verdict=PASS + Golden Path 覆盖对照表（JSON：每 Golden Path 步骤 → 执行记录中对应命令 → 通过与否）"

**可观测行为**: `evaluateContractNode` 将执行记录摘要（非完整 stdout，参见 ASSUMPTION "成本 < $2/轮"）+ 合同内容 + sprint-prd Golden Path 步骤送入 LLM 裁读；LLM 输出含 `coverage.steps` 数组（每步含 `step` / `mapped_cmd` / `passed` 字段）。

**验证命令**:
```bash
node --input-type=module -e "
import('./packages/brain/src/harness-final-e2e.js').then(m => {
  if (typeof m.validateCoverageTable !== 'function') {
    throw new Error('validateCoverageTable 未从 harness-final-e2e.js 导出');
  }
  console.log('OK: validateCoverageTable 已导出');
}).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });"
```

**硬阈值**: `validateCoverageTable` 函数导出存在，exit 0

---

### Step 5: Brain 代码覆盖校验 — 缺步强制 FAIL

**来源**: `[FROM_PRD]` — PRD "Brain 代码校验对照表：每个 Golden Path 步骤必须有映射命令，缺任一步 → 整体强制 FAIL（代码判，不信 LLM）"

**可观测行为**: `validateCoverageTable(coverage, goldenPathSteps)` 当 coverage.steps 缺少任何 GP 步骤时，返回 `{ok: false, missing: [...缺失步骤名...]}` —— 无论 LLM 自称 PASS 也无效。

**验证命令**:
```bash
node --input-type=module -e "
import('./packages/brain/src/harness-final-e2e.js').then(m => {
  const gpSteps = ['Step 1: 代码执行', 'Step 2: 记录落盘', 'Step 3: LLM 裁读'];
  const incompleteCoverage = {
    steps: [{ step: 'Step 1: 代码执行', mapped_cmd: 'echo test', passed: true }]
  };
  const result = m.validateCoverageTable(incompleteCoverage, gpSteps);
  if (result.ok !== false) throw new Error('缺步时 ok 应为 false，得: ' + JSON.stringify(result));
  if (!Array.isArray(result.missing)) throw new Error('missing 应为数组');
  if (!result.missing.includes('Step 2: 记录落盘')) throw new Error('missing 不含 Step 2');
  if (!result.missing.includes('Step 3: LLM 裁读')) throw new Error('missing 不含 Step 3');
  console.log('OK');
}).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });"
```

**硬阈值**: `ok=false`，`missing` 数组含所有缺失步骤名，exit 0

---

### Step 6: 回退开关 — EVALUATOR_LEGACY=1 走旧路径

**来源**: `[FROM_PRD]` — PRD "回退开关（env EVALUATOR_LEGACY=1 或 payload evaluator_mode: legacy）→ 走旧路径，默认新路径"

**可观测行为**: 当 `EVALUATOR_LEGACY=1` 时，`isLegacyMode()` 返回 `true`；`evaluateContractNode` 跳过 `executeContractCommands`，走原有 LLM spawn 路径（不创建执行记录文件）。

**验证命令**:
```bash
EVALUATOR_LEGACY=1 node --input-type=module -e "
import('./packages/brain/src/harness-final-e2e.js').then(m => {
  if (typeof m.isLegacyMode !== 'function') {
    throw new Error('isLegacyMode 未从 harness-final-e2e.js 导出');
  }
  if (!m.isLegacyMode()) {
    throw new Error('EVALUATOR_LEGACY=1 时 isLegacyMode() 应返回 true，得 false');
  }
  console.log('OK');
}).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });"
```

**硬阈值**: `isLegacyMode()` 在 `EVALUATOR_LEGACY=1` 时返回 `true`，exit 0

---

### Step 7: 取证唯一命名 — 重跑不覆盖

**来源**: `[FROM_PRD]` — PRD "执行记录文件 + 裁读输出均按运行实例唯一命名落盘，可完整还原"；对齐 #3345 命名协议（taskId.runInstance.prompt 8-hex 后缀）。

**可观测行为**: 同一 `sprintDir` 下两次调用 `executeContractCommands`（不同 `runId`），产生两个不同路径的执行记录文件，互不覆盖。

**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：#3345 已为 prompt/stdout 取证文件建立唯一命名机制；执行记录必须对齐同一原则，否则 task 重跑时当轮记录覆盖上轮，无法还原历史执行路径（Risk 1 的 mitigation 实现点）。

**验证命令**:
```bash
node --input-type=module -e "
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { mkdirSync, rmSync } from 'fs';
const dir = '/tmp/exec-unique-test';
mkdirSync(dir, { recursive: true });
try {
  const r1 = await executeContractCommands([{cmd:'echo run1',type:'bash'}], {sprintDir: dir, runId:'run-aaa'});
  const r2 = await executeContractCommands([{cmd:'echo run2',type:'bash'}], {sprintDir: dir, runId:'run-bbb'});
  if (r1.recordPath === r2.recordPath) {
    throw new Error('两次调用产生相同路径: ' + r1.recordPath + ' — 违反唯一命名原则');
  }
  console.log('OK: 两次调用路径不同 r1=' + r1.recordPath.split('/').pop() + ' r2=' + r2.recordPath.split('/').pop());
} finally {
  rmSync(dir, { recursive: true, force: true });
}"
```

**硬阈值**: `r1.recordPath !== r2.recordPath`，两文件均存在，exit 0

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 验证脚本 — evaluate 职责分离（local_api）
# 执行新 executeContractCommands + validateCoverageTable + evaluateContractNode 全流程验证
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/06120010-e2e-exec-judge-r2}"
WORK_DIR="/tmp/e2e-exec-judge-$$"
mkdir -p "$WORK_DIR"
export WORK_DIR   # 必须 export：node 子进程通过 process.env.WORK_DIR 读取（R2 修复 — R1 未 export 导致 fallback 到 /tmp/e2e-test，trap 清理失效）
trap "rm -rf $WORK_DIR" EXIT

echo "▶ Step 1: executeContractCommands 通过型 fixture"
node --input-type=module << 'JSEOF'
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync, mkdirSync } from 'fs';
const dir = process.env.WORK_DIR;

// 通过型 fixture（两条命令均 exit 0）
const result = await executeContractCommands(
  [
    { cmd: 'echo "step1-output"', type: 'bash' },
    { cmd: 'echo "step2-output"', type: 'bash' }
  ],
  { sprintDir: dir, runId: 'e2e-pass-fixture' }
);

if (!result.recordPath) throw new Error('recordPath 未返回');
const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));

// 验证执行记录 schema
if (!Array.isArray(record.commands)) throw new Error('commands 不是数组');
if (record.commands.length !== 2) throw new Error('commands.length 应为 2，得 ' + record.commands.length);

for (const [i, c] of record.commands.entries()) {
  if (c.exit_code !== 0) throw new Error(`commands[${i}].exit_code 应为 0，得 ${c.exit_code}`);
  if (typeof c.duration_ms !== 'number' || c.duration_ms < 0) throw new Error(`commands[${i}].duration_ms 不合法`);
  if (typeof c.stdout !== 'string') throw new Error(`commands[${i}].stdout 缺失`);
  if (typeof c.stderr !== 'string') throw new Error(`commands[${i}].stderr 缺失`);
}

if (!record.commands[0].stdout.includes('step1-output')) throw new Error('step1 stdout 未含预期');
if (!record.commands[1].stdout.includes('step2-output')) throw new Error('step2 stdout 未含预期');

console.log('✅ 通过型 fixture 执行记录 schema 验证通过 recordPath=' + result.recordPath.split('/').pop());
JSEOF

echo "▶ Step 2: 失败型 fixture — exit_code 捕获 + 原文保留"
node --input-type=module << 'JSEOF'
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync } from 'fs';
const dir = process.env.WORK_DIR;

const result = await executeContractCommands(
  [
    { cmd: 'echo "SUCCESS-LINE"', type: 'bash' },
    { cmd: 'echo "FAIL-MARKER-OUTPUT" >&2 && exit 42', type: 'bash' }
  ],
  { sprintDir: dir, runId: 'e2e-fail-fixture' }
);

const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
const c0 = record.commands[0];
const c1 = record.commands[1];

if (c0.exit_code !== 0) throw new Error('echo 应 exit_code=0，得 ' + c0.exit_code);
if (c1.exit_code === 0) throw new Error('失败命令 exit_code 应非 0，得 0');
const combined = (c1.stdout || '') + (c1.stderr || '');
if (!combined.includes('FAIL-MARKER-OUTPUT')) {
  throw new Error('FAIL: 失败原文 FAIL-MARKER-OUTPUT 未在执行记录中保留（combined=' + combined.slice(0, 300) + '）');
}

console.log('✅ 失败型 fixture 验证通过 exit_code=' + c1.exit_code);
JSEOF

echo "▶ Step 3: validateCoverageTable — 缺步强制 FAIL"
node --input-type=module << 'JSEOF'
import { validateCoverageTable } from './packages/brain/src/harness-final-e2e.js';

const gpSteps = [
  'Step 1: 代码执行层接管',
  'Step 2: 执行记录落盘',
  'Step 3: LLM 裁读覆盖对照表'
];

// 完整覆盖 → ok=true
const fullCoverage = {
  steps: gpSteps.map(step => ({ step, mapped_cmd: 'echo test', passed: true }))
};
const okResult = validateCoverageTable(fullCoverage, gpSteps);
if (okResult.ok !== true) throw new Error('完整覆盖时 ok 应为 true，得: ' + JSON.stringify(okResult));

// 缺步 → ok=false，missing 包含缺失步骤
const incompleteCoverage = {
  steps: [{ step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo', passed: true }]
};
const failResult = validateCoverageTable(incompleteCoverage, gpSteps);
if (failResult.ok !== false) throw new Error('缺步时 ok 应为 false，得: ' + JSON.stringify(failResult));
if (!failResult.missing.includes('Step 2: 执行记录落盘')) throw new Error('missing 不含 Step 2');
if (!failResult.missing.includes('Step 3: LLM 裁读覆盖对照表')) throw new Error('missing 不含 Step 3');

// 即使 LLM 自称 PASS，缺步时强制 FAIL
const llmClaimsCoverage = { ...incompleteCoverage, llm_verdict: 'PASS' };
const enforcedFail = validateCoverageTable(llmClaimsCoverage, gpSteps);
if (enforcedFail.ok !== false) throw new Error('LLM 自称 PASS 时 Brain 代码仍应强制 FAIL');

console.log('✅ validateCoverageTable 覆盖校验全部验证通过');
JSEOF

echo "▶ Step 4: 回退开关 — EVALUATOR_LEGACY=1 → isLegacyMode()=true"
EVALUATOR_LEGACY=1 node --input-type=module << 'JSEOF'
import { isLegacyMode } from './packages/brain/src/harness-final-e2e.js';
if (!isLegacyMode()) {
  throw new Error('EVALUATOR_LEGACY=1 时 isLegacyMode() 应返回 true，得 false');
}
console.log('✅ 回退开关检测通过');
JSEOF

echo "▶ Step 5: 取证唯一命名 — 两次调用产生不同路径"
node --input-type=module << 'JSEOF'
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
const dir = process.env.WORK_DIR;

const r1 = await executeContractCommands([{cmd:'echo run1',type:'bash'}], {sprintDir: dir, runId: 'run-unique-aaa'});
const r2 = await executeContractCommands([{cmd:'echo run2',type:'bash'}], {sprintDir: dir, runId: 'run-unique-bbb'});

if (r1.recordPath === r2.recordPath) {
  throw new Error('两次调用产生相同路径 ' + r1.recordPath + ' — 违反唯一命名（#3345）');
}
console.log('✅ 唯一命名验证通过 r1=' + r1.recordPath.split('/').pop() + ' r2=' + r2.recordPath.split('/').pop());
JSEOF

echo "▶ Step 6: evaluateContractNode 节点终态 — .brain-result.json 含 verdict + coverage + dispatch 语义（R5 fix B）"
# R2 新增：上轮 E2E 5步全测 helper 函数隔离，未验证 evaluateContractNode 节点本身写盘终态
# R5 修复：WORK_DIR 写最小 contract-dod.md fixture + capturedCmds.length>0 断言（Reviewer R4 fix B）
node --input-type=module << 'JSEOF'
import { evaluateContractNode } from './packages/brain/src/workflows/harness-task.graph.js';
import { executeContractCommands, validateCoverageTable } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const dir = process.env.WORK_DIR;
const brainResultPath = join(dir, '.brain-result.json');

// [R5 FIX B] 在 WORK_DIR 写最小 contract-dod.md fixture，确保节点有 BEHAVIOR 命令可读
writeFileSync(join(dir, 'contract-dod.md'), [
  '---',
  'skeleton: false',
  'journey_type: autonomous',
  '---',
  '# Contract DoD — e2e-node-terminus-fixture',
  '',
  '## BEHAVIOR 条目',
  '',
  '- [ ] [BEHAVIOR] e2e-terminus-dispatch-verify',
  "  Test: manual:bash -c 'echo e2e-terminus-dispatch-ok'",
  '  期望: OK',
].join('\n') + '\n', 'utf8');

// [R5 FIX B] 捕获 executeContractCommands 实际接收的命令数组（dispatch 语义验证）
const capturedCmds = [];
const capturingExecCmd = async (cmds, opts) => {
  capturedCmds.push(...cmds);
  return executeContractCommands(cmds, opts);
};

// 使用真实 executeContractCommands + mock judgeWithLlm（控制 LLM 成本）
const gpSteps = [
  'Step 1: 代码执行层接管',
  'Step 2: 执行记录落盘',
  'Step 3: LLM 裁读覆盖对照表',
  'Step 4: Brain 覆盖校验',
  'Step 5: verdict 写盘',
  'Step 6: 回退开关',
];

const state = {
  task: {
    id: 'e2e-node-terminus-fixture',
    payload: { sprint_dir: dir, journey_type: 'autonomous' },
  },
  evaluate_verdict: null,
  pr_url: null,
  worktreePath: null,
  prdContent: gpSteps.map(s => `### ${s}`).join('\n'),
  githubToken: 'fake-token',
  brainResultPath,
};

const result = await evaluateContractNode(state, {
  checkPrMerged: async () => false,
  resolveToken: async () => 'tok',
  verifyArtifacts: async () => ({ ran: true, ok: true }),
  runContractGate: async () => ({ ok: true }),
  // [R5 FIX B] capturing 版（确认命令来自 contract-dod.md，而非空数组）
  executeContractCommands: capturingExecCmd,
  // mock LLM 裁读（控制成本，避免真实 Claude API 调用）
  judgeWithLlm: async (execRecord, contractContent, steps) => ({
    verdict: 'PASS',
    coverage: {
      steps: steps.map(s => ({ step: s, mapped_cmd: 'echo e2e-fixture', passed: true })),
    },
  }),
});

// [R5 FIX B] 验证 dispatch 语义：节点从 contract-dod.md 读取并派发了 BEHAVIOR 命令（capturedCmds.length > 0）
if (capturedCmds.length === 0) {
  throw new Error('FAIL: evaluateContractNode 未从 contract-dod.md 读取并派发任何 BEHAVIOR 命令 — capturedCmds.length=0（Reviewer R4 fix B）');
}

// 验证 1: 节点返回 evaluate_coverage（PRD "coverage 字段写盘" 的 state 层证据）
if (!result.evaluate_coverage) {
  throw new Error('FAIL: evaluateContractNode 返回值缺 evaluate_coverage 字段');
}
if (!Array.isArray(result.evaluate_coverage.steps)) {
  throw new Error('FAIL: evaluate_coverage.steps 不是数组');
}
if (result.evaluate_coverage.steps.length !== gpSteps.length) {
  throw new Error(`FAIL: coverage.steps.length=${result.evaluate_coverage.steps.length}，期望 ${gpSteps.length}`);
}

// 验证 2: .brain-result.json 含 verdict + coverage（PRD "新增 coverage 字段" 的文件层证据）
const brainResult = JSON.parse(readFileSync(brainResultPath, 'utf8'));
if (!brainResult.verdict) {
  throw new Error('FAIL: .brain-result.json 缺 verdict 字段');
}
if (!brainResult.coverage) {
  throw new Error('FAIL: .brain-result.json 缺 coverage 字段（PRD 新增要求）');
}
if (!Array.isArray(brainResult.coverage.steps)) {
  throw new Error('FAIL: .brain-result.json coverage.steps 不是数组');
}

// 验证 3: coverage.steps 覆盖所有 GP 步骤（缺步 = Brain 代码应强制 FAIL，这里验证完整 PASS 路径）
const coveredSteps = new Set(brainResult.coverage.steps.map(s => s.step));
const missing = gpSteps.filter(s => !coveredSteps.has(s));
if (missing.length > 0) {
  throw new Error('FAIL: .brain-result.json coverage 缺以下 GP 步骤: ' + JSON.stringify(missing));
}

console.log('✅ evaluateContractNode 节点终态验证通过');
console.log('   verdict=' + brainResult.verdict);
console.log('   coverage.steps.length=' + brainResult.coverage.steps.length + '/' + gpSteps.length);
console.log('   capturedCmds.length=' + capturedCmds.length + ' (dispatch 语义验证通过)');
JSEOF

echo "▶ Step 7: evaluateContractNode 失败型终态 — verdict=FAIL + failed_step 字段（PRD 失败型路径 #5）"
node --input-type=module << 'JSEOF'
import { evaluateContractNode } from './packages/brain/src/workflows/harness-task.graph.js';
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = process.env.WORK_DIR;
const brainResultPath = join(dir, '.brain-result-fail.json');
const gpSteps = [
  'Step 1: 代码执行层接管',
  'Step 2: 执行记录落盘',
  'Step 3: LLM 裁读覆盖对照表',
];

const result = await evaluateContractNode({
  task: {
    id: 'e2e-fail-terminus-fixture',
    payload: { sprint_dir: dir, journey_type: 'autonomous' },
  },
  evaluate_verdict: null,
  pr_url: null,
  worktreePath: null,
  prdContent: gpSteps.map(s => `### ${s}`).join('\n'),
  githubToken: 'fake-token',
  brainResultPath,
}, {
  checkPrMerged: async () => false,
  resolveToken: async () => 'tok',
  verifyArtifacts: async () => ({ ran: true, ok: true }),
  runContractGate: async () => ({ ok: true }),
  // 真实执行器（执行记录落盘真实发生）
  executeContractCommands: async (cmds, opts) => executeContractCommands(cmds, opts),
  // mock LLM 裁读 — 返回 FAIL + failed_step（引用执行记录原文，不允许 LLM 自行发明）
  judgeWithLlm: async (execRecord, contractContent, steps) => ({
    verdict: 'FAIL',
    failed_step: 'Step 2: 执行记录落盘',
    coverage: {
      steps: [{ step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo test', passed: true }],
    },
  }),
});

// 验证 .brain-result.json 含 verdict=FAIL + failed_step（PRD 失败型路径 #5 核心要求）
const brainResult = JSON.parse(readFileSync(brainResultPath, 'utf8'));
if (brainResult.verdict !== 'FAIL') {
  throw new Error('FAIL: .brain-result.json verdict 应为 FAIL，得 ' + brainResult.verdict);
}
if (!brainResult.failed_step) {
  throw new Error('FAIL: .brain-result.json 缺 failed_step 字段（PRD 失败型路径 #5 要求）');
}
if (brainResult.failed_step !== 'Step 2: 执行记录落盘') {
  throw new Error('FAIL: failed_step 应为 "Step 2: 执行记录落盘"，得 ' + brainResult.failed_step);
}

console.log('✅ 失败型终态验证通过 verdict=' + brainResult.verdict + ' failed_step=' + brainResult.failed_step);
JSEOF

echo "▶ Step 8: 大输出截断 — stdout ≤ 4000 字节，TRNK_HEAD 头部 + TRNK_TAIL 尾部保留，exit_code=9 不丢（PRD 边界情况）"
node --input-type=module << 'JSEOF'
import { executeContractCommands } from './packages/brain/src/harness-final-e2e.js';
import { readFileSync } from 'fs';
const dir = process.env.WORK_DIR;

// 生成 > 4000 字节：TRNK_HEAD（ASCII字节数组避免引号嵌套）+ 5000 A + TRNK_TAIL，exit 9
const result = await executeContractCommands(
  [{
    cmd: "python3 -c \"import sys; h=bytes([84,82,78,75,95,72,69,65,68]).decode(); t=bytes([84,82,78,75,95,84,65,73,76]).decode(); sys.stdout.write(h+chr(65)*5000+t); sys.exit(9)\"",
    type: 'bash'
  }],
  { sprintDir: dir, runId: 'e2e-truncate-verify' }
);

const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
const c = record.commands[0];

// PRD 边界："不丢 exit_code"
if (c.exit_code !== 9) throw new Error(`FAIL: exit_code 期望 9，得 ${c.exit_code}`);

// PRD 边界："超截断阈值 → stdout ≤ 4000 字节"
const stdout = c.stdout || '';
if (stdout.length > 4000) throw new Error(`FAIL: stdout 超 4000 字节 length=${stdout.length}`);

// PRD 边界："保留头部"
if (!stdout.includes('TRNK_HEAD')) throw new Error(`FAIL: TRNK_HEAD 头部标记未保留 stdout[0..100]=${stdout.slice(0,100)}`);

// PRD 边界："保留尾部"
if (!stdout.includes('TRNK_TAIL')) throw new Error(`FAIL: TRNK_TAIL 尾部标记未保留 stdout[-100..]=${stdout.slice(-100)}`);

console.log(`✅ 截断验证通过: stdout.length=${stdout.length} exit_code=${c.exit_code}`);
JSEOF

echo "✅ Golden Path 全部 8 个步骤验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 新函数导出 + 执行记录 schema | `packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js` | executeContractCommands / validateCoverageTable / isLegacyMode | → 3 failures（函数不存在） |
| evaluateContractNode 重构 — 通过型 | `packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js` | evaluateContractNode 调用 executeContractCommands + 写 coverage | → 2 failures（旧路径无 coverage） |
| evaluateContractNode 重构 — 失败型 | `packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js` | failed_step 引用执行记录原文 | → 1 failure |
| 回退开关 | `packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js` | EVALUATOR_LEGACY=1 跳过新路径 | → 1 failure |
