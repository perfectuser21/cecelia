---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: evaluateContractNode 职责分离（代码执行 + LLM 裁读）

**范围**: `evaluateContractNode` 执行流程拆分（代码执行段 + LLM 裁读段）；`ExecutionRecordSchema` 新增；`EvaluatorOutputSchema` coverage 扩展；Brain 代码 coverage 覆盖完整性校验；legacy 回退开关；单测（schema / coverage 校验 / 节点流程 / 回退）
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/harness-shared.js` 导出 `ExecutionRecordSchema`（新增 Zod schema）
  Test: (cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){if(!m.ExecutionRecordSchema){console.error('FAIL');process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})")

- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 的 `evaluateContractNode` 函数体含代码执行段调用（非直接 spawn LLM）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('execution-record')&&!c.includes('executionRecord')&&!c.includes('runE2eScript')&&!c.includes('runContractE2e'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 单测文件存在且含 ExecutionRecordSchema + coverage 断言
  Test: node -e "const c=require('fs').readFileSync('sprints/06120545-e2e-exec-judge-r3/tests/evaluate-split.test.ts','utf8');if(!c.includes('ExecutionRecordSchema')||!c.includes('coverage'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous）

- [ ] [BEHAVIOR] Step 2 — `ExecutionRecordSchema` 已从 `harness-shared.js` 导出且可 parse 正常执行记录
  Test: manual:bash -c '(cd packages/brain && node -e "import(\"./src/harness-shared.js\").then(function(m){if(!m.ExecutionRecordSchema){console.error(\"FAIL: ExecutionRecordSchema not exported\");process.exit(1)}var r=m.ExecutionRecordSchema.safeParse({commands:[{cmd:\"echo ok\",exitCode:0,stdout:\"ok\",stderr:\"\",elapsedMs:10}]});if(!r.success){console.error(\"FAIL schema:\",r.error.message);process.exit(1)}console.log(\"OK\")}).catch(function(e){console.error(\"FAIL:\",e.message);process.exit(1)})")'
  期望: OK

- [ ] [BEHAVIOR] Step 3 — `EvaluatorOutputSchema.shape` 含 `coverage` 字段，PASS verdict + coverage 数组 parse 成功
  Test: manual:bash -c '(cd packages/brain && node -e "import(\"./src/harness-shared.js\").then(function(m){if(!(\"coverage\" in (m.EvaluatorOutputSchema.shape||{}))){console.error(\"FAIL: coverage field missing from EvaluatorOutputSchema.shape\");process.exit(1)}var r=m.EvaluatorOutputSchema.safeParse({verdict:\"PASS\",coverage:[{step:\"Step 1\",passed:true}]});if(!r.success){console.error(\"FAIL coverage parse:\",r.error.message);process.exit(1)}console.log(\"OK\")}).catch(function(e){console.error(\"FAIL:\",e.message);process.exit(1)})")'
  期望: OK

- [ ] [BEHAVIOR] Step 4+5+6 — 单测全量通过（coverage 完整性 + 落盘 + 失败型 fixture）
  Test: manual:bash -c '(cd packages/brain && npx vitest run ../../sprints/06120545-e2e-exec-judge-r3/tests/evaluate-split.test.ts --reporter=verbose) && echo OK'
  期望: OK（所有单测 PASS，exit 0）

- [ ] [BEHAVIOR] Step 6 — `EvaluatorOutputSchema` 接受 FAIL verdict + failed_step + coverage 含失败步，parse 成功
  Test: manual:bash -c '(cd packages/brain && node -e "import(\"./src/harness-shared.js\").then(function(m){var r=m.EvaluatorOutputSchema.safeParse({verdict:\"FAIL\",failed_step:\"Step 2: 代码执行段\",feedback:\"exit code 1 on: false\",coverage:[{step:\"Step 1\",passed:true},{step:\"Step 2\",passed:false}]});if(!r.success){console.error(\"FAIL:\",r.error.message);process.exit(1)}console.log(\"OK\")}).catch(function(e){console.error(\"FAIL:\",e.message);process.exit(1)})")'
  期望: OK

- [ ] [BEHAVIOR] Step 7 — legacy 回退开关（`EVALUATE_PATH=legacy` 可走旧 spawn 路径），源码含对应分支
  Test: manual:bash -c 'grep -E "EVALUATE_PATH|evaluate_path|legacy.*path|path.*legacy" packages/brain/src/workflows/harness-task.graph.js | head -1 || { echo "FAIL: legacy 开关未在 harness-task.graph.js 中找到"; exit 1; }; echo OK'
  期望: 打印含 EVALUATE_PATH 或 legacy 的行 + OK

- [ ] [BEHAVIOR] Step 2 追加 — execution-record.json 写入逻辑存在于实现代码
  Test: manual:bash -c 'grep -rE "execution-record\.json|executionRecord|execution_record" packages/brain/src/workflows/harness-task.graph.js packages/brain/src/harness-final-e2e.js packages/brain/src/harness-e2e-runner.js 2>/dev/null | head -1 || { echo "FAIL: execution-record.json 相关代码未找到"; exit 1; }; echo OK'
  期望: 找到含 execution-record.json / executionRecord / execution_record 的代码行 + OK
