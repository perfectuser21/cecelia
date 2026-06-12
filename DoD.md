contract_branch: cp-harness-propose-r3-5c20be05
sprint_dir: sprints/06120850-e2e-exec-judge-r4

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: E2E 代码执行 + LLM 裁读（evaluator 职责分离）R4

**范围**: `packages/engine/src/harness/evaluate.js`（编排），`packages/engine/src/harness/runner.js`（执行记录落盘），`packages/engine/src/harness/e2e-judge.js`（LLM 裁读），`packages/brain/src/harness-shared.js`（schema 扩展），`packages/engine/tests/harness/evaluate.test.ts`（单测 + fixture）
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/engine/src/harness/evaluate.js` 存在，导出 `runEvaluate`、`parseE2EScript` 函数，读取 `EVAL_LEGACY` 和 `EVAL_PAYLOAD` env var
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/evaluate.js','utf8');if(!c.includes('runEvaluate'))process.exit(1);if(!c.includes('parseE2EScript'))process.exit(1);if(!c.includes('EVAL_LEGACY'))process.exit(1);if(!c.includes('EVAL_PAYLOAD'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/src/harness/e2e-judge.js` 存在，导出 `judgeExecution` 函数
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/e2e-judge.js','utf8');if(!c.includes('judgeExecution'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/src/harness/runner.js` 存在，导出 `executeAndRecord` 函数并依赖 `runScenarioCommand`
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/runner.js','utf8');if(!c.includes('executeAndRecord'))process.exit(1);if(!c.includes('runScenarioCommand'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/harness-shared.js` 中 `EvaluatorOutputSchema` 新增 `coverage` 字段（zod optional array）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-shared.js','utf8');if(!c.includes('coverage'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/engine/tests/harness/evaluate.test.ts` 存在，包含 pass/fail fixture、EVAL_LEGACY 和 use_legacy_eval payload 测试
  Test: node -e "const c=require('fs').readFileSync('packages/engine/tests/harness/evaluate.test.ts','utf8');if(!c.includes('EVAL_LEGACY'))process.exit(1);if(!c.includes('use_legacy_eval'))process.exit(1);if(!c.includes('pass'))process.exit(1);if(!c.includes('fail'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 通过型 fixture 触发后，执行记录文件落盘且 schema 正确（exit_code=0 / stdout 非空 / duration_ms≥0）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b1-pass-fixture.sh
  期望: OK

- [x] [BEHAVIOR] coverage record_segment 内容真实性 — 含 fixture 已知 sentinel，排除 LLM 杜撰
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b2-sentinel.sh
  期望: OK

- [x] [BEHAVIOR] 失败型 fixture（exit_code=1）→ verdict=FAIL，failed_step 非空，feedback 非空（引用执行记录）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b3-fail-fixture.sh
  期望: OK

- [x] [BEHAVIOR] EVAL_LEGACY=1 时，evaluate 运行完毕但 exec-records 目录无新文件（新执行器跳过）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b4-eval-legacy.sh
  期望: OK

- [x] [BEHAVIOR] use_legacy_eval:true payload 时，exec-records 目录无新文件（payload 回退机制独立于 env var）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b5-payload-legacy.sh
  期望: OK

- [x] [BEHAVIOR] .brain-result.json 包含 verdict 和 coverage 两个字段，且禁用字段 result/records 不出现（EvaluatorOutputSchema 扩展兼容）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b6-schema-check.sh
  期望: OK

- [x] [BEHAVIOR] 执行记录为空（脚本无 stdout 输出）→ verdict=FAIL，不调用 LLM，feedback 标注「空」
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b7-empty-stdout.sh
  期望: OK

- [x] [BEHAVIOR] self-hosting 自验 — local_api E2E 脚本模式的 fixture 经新执行器运行，verdict=PASS，coverage≥5
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b8-selfhosting.sh
  期望: OK

- [x] [BEHAVIOR] LLM 裁读超时（LLM_JUDGE_TIMEOUT_MS=1）→ verdict=FAIL，exec-records 有新文件（代码执行层不受 LLM 超时影响），feedback 含 timeout 字样（PRD §边界情况）
  Test: manual:bash sprints/06120850-e2e-exec-judge-r4/behaviors/b9-llm-timeout.sh
  期望: OK
