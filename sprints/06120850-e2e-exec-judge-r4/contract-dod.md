---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: E2E 代码执行 + LLM 裁读（evaluator 职责分离）R4

**范围**: `packages/engine/src/harness/evaluate.js`（编排），`packages/engine/src/harness/runner.js`（执行记录落盘），`packages/engine/src/harness/e2e-judge.js`（LLM 裁读），`packages/brain/src/harness-shared.js`（schema 扩展），`packages/engine/tests/harness/evaluate.test.ts`（单测 + fixture）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/engine/src/harness/evaluate.js` 存在，导出 `runEvaluate`、`parseE2EScript` 函数，读取 `EVAL_LEGACY` 和 `EVAL_PAYLOAD` env var
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/evaluate.js','utf8');if(!c.includes('runEvaluate'))process.exit(1);if(!c.includes('parseE2EScript'))process.exit(1);if(!c.includes('EVAL_LEGACY'))process.exit(1);if(!c.includes('EVAL_PAYLOAD'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/engine/src/harness/e2e-judge.js` 存在，导出 `judgeExecution` 函数
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/e2e-judge.js','utf8');if(!c.includes('judgeExecution'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/engine/src/harness/runner.js` 存在，导出 `executeAndRecord` 函数并依赖 `runScenarioCommand`
  Test: node -e "const c=require('fs').readFileSync('packages/engine/src/harness/runner.js','utf8');if(!c.includes('executeAndRecord'))process.exit(1);if(!c.includes('runScenarioCommand'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/harness-shared.js` 中 `EvaluatorOutputSchema` 新增 `coverage` 字段（zod optional array）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-shared.js','utf8');if(!c.includes('coverage'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/engine/tests/harness/evaluate.test.ts` 存在，包含 pass/fail fixture、EVAL_LEGACY 和 use_legacy_eval payload 测试
  Test: node -e "const c=require('fs').readFileSync('packages/engine/tests/harness/evaluate.test.ts','utf8');if(!c.includes('EVAL_LEGACY'))process.exit(1);if(!c.includes('use_legacy_eval'))process.exit(1);if(!c.includes('pass'))process.exit(1);if(!c.includes('fail'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 通过型 fixture 触发后，执行记录文件落盘且 schema 正确（exit_code=0 / stdout 非空 / duration_ms≥0）
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-pass-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "behavior_test_step1: trigger OK"
echo "behavior_test_step2: execution OK"
exit 0
FIXTURE
    chmod +x /tmp/eval-pass-b.sh
    SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-b.sh node packages/engine/src/harness/evaluate.js
    RECF=$(ls -t "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | head -1)
    [ -n "$RECF" ] || { echo "FAIL: 执行记录未生成"; exit 1; }
    REC=$(cat "$RECF")
    echo "$REC" | jq -e ".exit_code == 0 and (.stdout | length) > 0 and (.duration_ms >= 0)" || { echo "FAIL: 执行记录 schema 不符"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] coverage record_segment 内容真实性 — 含 fixture 已知 sentinel，排除 LLM 杜撰
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-sentinel-b2.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "EXEC_SENTINEL_XK9W: execution_verified"
echo "EXEC_SENTINEL_XK9W: record_captured"
exit 0
FIXTURE
    chmod +x /tmp/eval-sentinel-b2.sh
    SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-sentinel-b2.sh node packages/engine/src/harness/evaluate.js
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e ".verdict == \"PASS\"" || { echo "FAIL: verdict"; exit 1; }
    echo "$BRES" | jq -e "(.coverage | type) == \"array\" and (.coverage | length) >= 1" || { echo "FAIL: coverage 空"; exit 1; }
    echo "$BRES" | jq -e '"'"'.coverage | map(.record_segment // "") | join(" ") | test("EXEC_SENTINEL_XK9W")'"'"' || { echo "FAIL: record_segment 未含 fixture 已知标记，疑似 LLM 杜撰"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] 失败型 fixture（exit_code=1）→ verdict=FAIL，failed_step 非空，feedback 非空（引用执行记录）
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-fail-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "DB_CONNECTION_REFUSED: localhost:5432 unreachable"
exit 1
FIXTURE
    chmod +x /tmp/eval-fail-b.sh
    # gate-allow: cheat/or-true 失败型 fixture 预期非 0 exit，|| true 必要；断言在后续 jq 行
    EVAL_LOG=$(SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-fail-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e ".verdict == \"FAIL\"" || { echo "FAIL: 失败型应为 FAIL"; exit 1; }
    echo "$BRES" | jq -e "(.failed_step | type) == \"string\" and (.failed_step | length) > 0" || { echo "FAIL: failed_step 空"; exit 1; }
    echo "$BRES" | jq -e "(.feedback | length) > 20" || { echo "FAIL: feedback 过短"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] EVAL_LEGACY=1 时，evaluate 运行完毕但 exec-records 目录无新文件（新执行器跳过）
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-legacy-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "legacy_path_test"
exit 0
FIXTURE
    chmod +x /tmp/eval-legacy-b.sh
    PREV=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    # gate-allow: cheat/or-true EVAL_LEGACY 路径可能 exit 非 0，|| true 必要；断言在 AFTER 比较行
    LEGACY_LOG=$(EVAL_LEGACY=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-legacy-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
    AFTER=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    [ "$AFTER" -eq "$PREV" ] || { echo "FAIL: EVAL_LEGACY=1 时执行记录数量增加"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] use_legacy_eval:true payload 时，exec-records 目录无新文件（payload 回退机制独立于 env var）
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-payload-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "payload_legacy_test"
exit 0
FIXTURE
    chmod +x /tmp/eval-payload-b.sh
    PREV_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    # gate-allow: cheat/or-true payload 回退路径可能 exit 非 0，|| true 必要；断言在 AFTER_P 比较行
    PAYLOAD_LOG=$(EVAL_PAYLOAD='"'"'{"use_legacy_eval":true}'"'"' SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-payload-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
    AFTER_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    [ "$AFTER_P" -eq "$PREV_P" ] || { echo "FAIL: use_legacy_eval:true payload 时执行记录数量增加"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] .brain-result.json 包含 verdict 和 coverage 两个字段，且禁用字段 result/records 不出现（EvaluatorOutputSchema 扩展兼容）
  Test: manual:bash -c '
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e "has(\"verdict\") and has(\"coverage\")" || { echo "FAIL: 字段缺失"; exit 1; }
    echo "$BRES" | jq -e ".verdict == \"PASS\" or .verdict == \"FAIL\" or .verdict == \"FIXED\"" || { echo "FAIL: verdict 不在枚举内"; exit 1; }
    echo "$BRES" | jq -e "has(\"result\") | not" || { echo "FAIL: 禁用字段 result 出现"; exit 1; }
    echo "$BRES" | jq -e "has(\"records\") | not" || { echo "FAIL: 禁用字段 records 出现"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] 执行记录为空（脚本无 stdout 输出）→ verdict=FAIL，不调用 LLM，feedback 标注「空」
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-empty-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
exit 0
FIXTURE
    chmod +x /tmp/eval-empty-b.sh
    # gate-allow: cheat/or-true 空 stdout 时 evaluate 可能 exit 非 0，|| true 必要；断言在后续 jq 行
    EMPTY_LOG=$(SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-empty-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e ".verdict == \"FAIL\"" || { echo "FAIL: 空记录应为 FAIL"; exit 1; }
    echo "$BRES" | jq -r ".feedback" | grep -qi "空\|empty" || { echo "FAIL: feedback 未标注空记录原因"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] self-hosting 自验 — local_api E2E 脚本模式的 fixture 经新执行器运行，verdict=PASS，coverage≥5
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-selfhosting-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "self_hosting_step1: evaluate node received contract OK"
echo "self_hosting_step2: code executed in runner container exit=0"
echo "self_hosting_step3: structured execution record captured"
echo "self_hosting_step4: coverage table validated by Brain"
echo "self_hosting_step5: brain-result.json written"
FIXTURE
    chmod +x /tmp/eval-selfhosting-b.sh
    SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-selfhosting-b.sh node packages/engine/src/harness/evaluate.js
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e ".verdict == \"PASS\"" || { echo "FAIL: self-hosting verdict 非 PASS"; exit 1; }
    echo "$BRES" | jq -e "(.coverage | length) >= 5" || { echo "FAIL: self-hosting coverage 不足 5 步"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] LLM 裁读超时（LLM_JUDGE_TIMEOUT_MS=1）→ verdict=FAIL，exec-records 有新文件（代码执行层不受 LLM 超时影响），feedback 含 timeout 字样（PRD §边界情况）
  Test: manual:bash -c '
    SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
    cat > /tmp/eval-llm-timeout-b.sh << '"'"'FIXTURE'"'"'
#!/bin/bash
echo "step1_trigger: evaluate node received contract OK"
echo "step2_execution: code executed"
FIXTURE
    chmod +x /tmp/eval-llm-timeout-b.sh
    BEFORE_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    # gate-allow: cheat/or-true LLM 超时时 evaluate 预期 exit 非 0，|| true 必要；断言在后续 jq 行
    TIMEOUT_LOG=$(LLM_JUDGE_TIMEOUT_MS=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-llm-timeout-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
    AFTER_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
    [ "$AFTER_CNT" -gt "$BEFORE_CNT" ] || { echo "FAIL: LLM 超时时执行记录未生成"; exit 1; }
    BRES=$(cat ".brain-result.json")
    echo "$BRES" | jq -e ".verdict == \"FAIL\"" || { echo "FAIL: LLM 超时应返回 FAIL"; exit 1; }
    echo "$BRES" | jq -r ".feedback // \"\"" | grep -qi "timeout" || { echo "FAIL: feedback 未含 timeout 字样"; exit 1; }
    echo OK
  '
  期望: OK
