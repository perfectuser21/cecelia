---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: evaluate 职责分离（代码执行 E2E + 轻量 LLM 裁读）

**范围**: `evaluateContractNode` 节点重构 — 代码层执行 BEHAVIOR 命令 + 结构化执行记录落盘 + LLM 裁读记录 + Brain 代码覆盖校验
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `harness-final-e2e.js` 导出三个新函数（executeContractCommands / validateCoverageTable / isLegacyMode）
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/harness-final-e2e.js','utf8');if(!src.includes('executeContractCommands'))process.exit(1);if(!src.includes('validateCoverageTable'))process.exit(1);if(!src.includes('isLegacyMode'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `harness-initiative-evaluate-exec-judge.test.js` 回归测试文件存在且含覆盖校验用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-initiative-evaluate-exec-judge.test.js','utf8');if(!c.includes('executeContractCommands'))process.exit(1);if(!c.includes('validateCoverageTable'))process.exit(1);if(!c.includes('EVALUATOR_LEGACY'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，autonomous — 测 Brain 代码层）

- [ ] [BEHAVIOR] `executeContractCommands` 函数已从 `harness-final-e2e.js` 导出，通过型 fixture 执行记录 schema 正确（exit_code / stdout / stderr / duration_ms 字段完整）
  Test: manual:bash -c 'node --input-type=module -e "
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { readFileSync, mkdirSync, rmSync } from \"fs\";
const dir = \"/tmp/dod-beh1-$RANDOM\";
mkdirSync(dir, {recursive:true});
try {
  const result = await executeContractCommands([{cmd:\"echo beh1-fixture\",type:\"bash\"}], {sprintDir:dir,runId:\"dod-beh1\"});
  if(!result.recordPath) throw new Error(\"recordPath 缺失\");
  const record = JSON.parse(readFileSync(result.recordPath,\"utf8\"));
  const c = record.commands[0];
  if(typeof c.exit_code !== \"number\") throw new Error(\"缺 exit_code\");
  if(typeof c.duration_ms !== \"number\") throw new Error(\"缺 duration_ms\");
  if(!c.stdout.includes(\"beh1-fixture\")) throw new Error(\"stdout 未含预期\");
  console.log(\"OK\");
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] 失败型命令 — `exit 42` 的 `exit_code` 非零且失败 stderr 原文保留于执行记录（LLM 不许自行发明错误原因）
  Test: manual:bash -c 'node --input-type=module -e "
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { readFileSync, mkdirSync, rmSync } from \"fs\";
const dir = \"/tmp/dod-beh2-$RANDOM\";
mkdirSync(dir, {recursive:true});
try {
  const result = await executeContractCommands(
    [{cmd:\"echo FAIL-ORIGIN >&2 && exit 42\",type:\"bash\"}],
    {sprintDir:dir,runId:\"dod-fail\"}
  );
  const record = JSON.parse(readFileSync(result.recordPath,\"utf8\"));
  const c = record.commands[0];
  if(c.exit_code === 0) throw new Error(\"FAIL: exit_code 应非 0\");
  const combined = (c.stdout||\"\")+\" \"+(c.stderr||\"\");
  if(!combined.includes(\"FAIL-ORIGIN\")) throw new Error(\"FAIL: 失败原文未保留 combined=\"+combined.slice(0,200));
  console.log(\"OK\");
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] `validateCoverageTable(coverage, gpSteps)` — 缺少 GP 步骤时返回 `{ok: false, missing: [...]}` 强制 FAIL，不信任 LLM 自称 PASS
  Test: manual:bash -c 'node --input-type=module -e "
import { validateCoverageTable } from \"./packages/brain/src/harness-final-e2e.js\";
const gpSteps = [\"Step 1: 代码执行\",\"Step 2: 记录落盘\",\"Step 3: LLM 裁读\"];
// 缺步场景
const r1 = validateCoverageTable({steps:[{step:\"Step 1: 代码执行\",mapped_cmd:\"echo\",passed:true}]}, gpSteps);
if(r1.ok !== false) throw new Error(\"FAIL: 缺步时 ok 应 false，得 \"+JSON.stringify(r1));
if(!r1.missing.includes(\"Step 2: 记录落盘\")) throw new Error(\"missing 不含 Step 2\");
// 完整覆盖场景
const fullCov = {steps: gpSteps.map(s=>({step:s,mapped_cmd:\"echo\",passed:true}))};
const r2 = validateCoverageTable(fullCov, gpSteps);
if(r2.ok !== true) throw new Error(\"FAIL: 完整覆盖时 ok 应 true，得 \"+JSON.stringify(r2));
console.log(\"OK\");
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] error path — `validateCoverageTable` 收到空 steps 数组时返回 `{ok: false, missing: [...全部 GP 步骤...]}`
  Test: manual:bash -c 'node --input-type=module -e "
import { validateCoverageTable } from \"./packages/brain/src/harness-final-e2e.js\";
const gpSteps = [\"Step A\",\"Step B\",\"Step C\"];
const r = validateCoverageTable({steps:[]}, gpSteps);
if(r.ok !== false) throw new Error(\"FAIL: 空 steps 时 ok 应 false\");
if(!Array.isArray(r.missing) || r.missing.length !== 3) throw new Error(\"FAIL: missing 应含所有 3 步\");
console.log(\"OK\");
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] 回退开关 — `EVALUATOR_LEGACY=1` 时 `isLegacyMode()` 返回 `true`；未设时返回 `false`
  Test: manual:bash -c '
result_on=$(EVALUATOR_LEGACY=1 node --input-type=module -e "
import { isLegacyMode } from \"./packages/brain/src/harness-final-e2e.js\";
console.log(isLegacyMode() ? \"true\" : \"false\");
" 2>&1)
result_off=$(node --input-type=module -e "
import { isLegacyMode } from \"./packages/brain/src/harness-final-e2e.js\";
console.log(isLegacyMode() ? \"true\" : \"false\");
" 2>&1)
[ "$result_on" = "true" ] || { echo "FAIL: EVALUATOR_LEGACY=1 时期望 true，得 $result_on"; exit 1; }
[ "$result_off" = "false" ] || { echo "FAIL: 未设时期望 false，得 $result_off"; exit 1; }
echo "OK"
'
  期望: OK

- [ ] [BEHAVIOR] 取证唯一命名 — 同 sprintDir 下两次 executeContractCommands（不同 runId）产生不同 recordPath（对齐 #3345 运行实例唯一命名，防重跑覆盖）
  Test: manual:bash -c 'node --input-type=module -e "
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { mkdirSync, rmSync } from \"fs\";
const dir = \"/tmp/dod-unique-$RANDOM\";
mkdirSync(dir,{recursive:true});
try {
  const r1 = await executeContractCommands([{cmd:\"echo a\",type:\"bash\"}],{sprintDir:dir,runId:\"run-001\"});
  const r2 = await executeContractCommands([{cmd:\"echo b\",type:\"bash\"}],{sprintDir:dir,runId:\"run-002\"});
  if(r1.recordPath === r2.recordPath) throw new Error(\"FAIL: 两次路径相同 \"+r1.recordPath);
  console.log(\"OK: \"+r1.recordPath.split(\"/\").pop()+\" vs \"+r2.recordPath.split(\"/\").pop());
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] evaluateContractNode（新路径）节点终态 — dispatch 语义（capturedCmds.length>0）+ evaluate_coverage + .brain-result.json 含 verdict + coverage（R5 fix A+B）
  Test: manual:bash -c 'RAND=$RANDOM; export DIR="/tmp/dod-beh7-$RAND"; mkdir -p "$DIR"; node --input-type=module -e "
import { evaluateContractNode } from \"./packages/brain/src/workflows/harness-task.graph.js\";
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from \"fs\";
import { join } from \"path\";
const dir = process.env.DIR;
const brainResultPath = join(dir, \".brain-result.json\");
const gpSteps = [\"Step 1: 代码执行层接管\",\"Step 2: 执行记录落盘\",\"Step 3: LLM 裁读\"];
try {
  writeFileSync(join(dir, \"contract-dod.md\"), \"---\\njourney_type: autonomous\\n---\\n# DoD\\n\\n## BEHAVIOR 条目\\n\\n- [ ] [BEHAVIOR] beh7-dispatch-verify\\n  Test: manual:bash -c 'echo beh7-dispatch-ok'\\n  期望: OK\\n\", \"utf8\");
  const capturedCmds = [];
  const capturingExecCmd = async(cmds,opts)=>{capturedCmds.push(...cmds);return executeContractCommands(cmds,opts);};
  const result = await evaluateContractNode({
    task:{ id:\"dod-beh7\", payload:{ sprint_dir:dir, journey_type:\"autonomous\" } },
    evaluate_verdict:null, pr_url:null, worktreePath:null,
    prdContent: gpSteps.map(s=>\"### \"+s).join(\"\\n\"),
    githubToken:\"fake-token\", brainResultPath,
  },{
    checkPrMerged: async()=>false,
    resolveToken: async()=>\"tok\",
    verifyArtifacts: async()=>({ran:true,ok:true}),
    runContractGate: async()=>({ok:true}),
    executeContractCommands: capturingExecCmd,
    judgeWithLlm: async(rec,contract,steps)=>({
      verdict:\"PASS\",
      coverage:{steps:steps.map(s=>({step:s,mapped_cmd:\"echo\",passed:true}))},
    }),
  });
  if(capturedCmds.length===0) throw new Error(\"FAIL: dispatch 语义失败 capturedCmds.length=0（节点未从 contract-dod.md 读取并派发 BEHAVIOR 命令）\");
  if(!result.evaluate_coverage) throw new Error(\"FAIL: 结果缺 evaluate_coverage\");
  const br = JSON.parse(readFileSync(brainResultPath,\"utf8\"));
  if(!br.verdict) throw new Error(\"FAIL: .brain-result.json 缺 verdict\");
  if(!br.coverage) throw new Error(\"FAIL: .brain-result.json 缺 coverage\");
  if(!Array.isArray(br.coverage.steps)) throw new Error(\"FAIL: coverage.steps 非数组\");
  console.log(\"OK capturedCmds=\"+capturedCmds.length);
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK capturedCmds=1

- [ ] [BEHAVIOR] evaluateContractNode 失败型终态 — judgeWithLlm 返回 verdict=FAIL + failed_step 时，.brain-result.json 含 verdict=FAIL + failed_step 字段（PRD 失败型路径 #5："LLM 裁读 verdict=FAIL + 具体 failed_step"）
  来源: `[FROM_PRD]` — PRD 失败型路径 #5："失败型脚本 fixture → …LLM 裁读 verdict=FAIL + 具体 failed_step"
  Test: manual:bash -c 'RAND=$RANDOM; export DIR="/tmp/dod-beh8-$RAND"; mkdir -p "$DIR"; node --input-type=module -e "
import { evaluateContractNode } from \"./packages/brain/src/workflows/harness-task.graph.js\";
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { readFileSync, rmSync } from \"fs\";
import { join } from \"path\";
const dir = process.env.DIR;
const brainResultPath = join(dir, \".brain-result.json\");
const gpSteps = [\"Step 1: 代码执行层接管\",\"Step 2: 执行记录落盘\",\"Step 3: LLM 裁读\"];
try {
  await evaluateContractNode({
    task:{ id:\"dod-beh8\", payload:{ sprint_dir:dir, journey_type:\"autonomous\" } },
    evaluate_verdict:null, pr_url:null, worktreePath:null,
    prdContent: gpSteps.map(s=>\"### \"+s).join(\"\\n\"),
    githubToken:\"fake-token\", brainResultPath,
  },{
    checkPrMerged: async()=>false,
    resolveToken: async()=>\"tok\",
    verifyArtifacts: async()=>({ran:true,ok:true}),
    runContractGate: async()=>({ok:true}),
    executeContractCommands: async(cmds,opts)=>executeContractCommands(cmds,opts),
    judgeWithLlm: async()=>({ verdict:\"FAIL\", failed_step:\"Step 2: 执行记录落盘\", coverage:{steps:[]} }),
  });
  const br = JSON.parse(readFileSync(brainResultPath,\"utf8\"));
  if(br.verdict !== \"FAIL\") throw new Error(\"FAIL: .brain-result.json verdict 应为 FAIL，得 \"+br.verdict);
  if(!br.failed_step) throw new Error(\"FAIL: .brain-result.json 缺 failed_step 字段\");
  if(br.failed_step !== \"Step 2: 执行记录落盘\") throw new Error(\"FAIL: failed_step 不符，得 \"+br.failed_step);
  console.log(\"OK\");
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK

- [ ] [BEHAVIOR] 大输出截断 — stdout/stderr 超 4000 字节时保留头部（TRNK_HEAD）+ 尾部（TRNK_TAIL），exit_code 仍正确捕获（PRD 边界情况："超截断阈值 → 保留头尾，不丢 exit_code"）
  来源: `[FROM_PRD]` — PRD 边界情况段："执行记录 stdout/stderr 超过截断阈值 → 保留头尾，中间截断，不丢 exit code"
  Test: manual:bash -c 'node --input-type=module -e "
import { executeContractCommands } from \"./packages/brain/src/harness-final-e2e.js\";
import { readFileSync, mkdirSync, rmSync } from \"fs\";
const dir = \"/tmp/dod-trunc-\" + process.pid;
mkdirSync(dir,{recursive:true});
try {
  const result = await executeContractCommands(
    [{cmd:\"python3 -c 'import sys; h=chr(84)+chr(82)+chr(78)+chr(75)+chr(95)+chr(72)+chr(69)+chr(65)+chr(68); t=chr(84)+chr(82)+chr(78)+chr(75)+chr(95)+chr(84)+chr(65)+chr(73)+chr(76); sys.stdout.write(h+chr(65)*5000+t); sys.exit(9)'\",type:\"bash\"}],
    {sprintDir:dir,runId:\"trunc-9\"}
  );
  const record = JSON.parse(readFileSync(result.recordPath,\"utf8\"));
  const c = record.commands[0];
  if(c.exit_code !== 9) throw new Error(\"FAIL: exit_code 期望 9，得 \"+c.exit_code);
  const stdout = c.stdout || \"\";
  if(stdout.length > 4000) throw new Error(\"FAIL: stdout 超 4000 字节 length=\"+stdout.length);
  if(!stdout.includes(\"TRNK_HEAD\")) throw new Error(\"FAIL: TRNK_HEAD 头部标记未保留\");
  if(!stdout.includes(\"TRNK_TAIL\")) throw new Error(\"FAIL: TRNK_TAIL 尾部标记未保留\");
  console.log(\"OK: length=\"+stdout.length+\" exit_code=\"+c.exit_code);
} finally { rmSync(dir,{recursive:true,force:true}); }
" 2>&1'
  期望: OK
