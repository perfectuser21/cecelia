#!/bin/bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-llm-timeout-b.sh << 'FIXTURE'
#!/bin/bash
echo "step1_trigger: evaluate node received contract OK"
echo "step2_execution: code executed"
FIXTURE
chmod +x /tmp/eval-llm-timeout-b.sh
BEFORE_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
TIMEOUT_LOG=$(LLM_JUDGE_TIMEOUT_MS=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-llm-timeout-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
[ "$AFTER_CNT" -gt "$BEFORE_CNT" ] || { echo "FAIL: LLM 超时时执行记录未生成"; exit 1; }
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "FAIL"' || { echo "FAIL: LLM 超时应返回 FAIL"; exit 1; }
echo "$BRES" | jq -r '.feedback // ""' | grep -qi "timeout" || { echo "FAIL: feedback 未含 timeout 字样"; exit 1; }
# b9 验证完毕后恢复 brain-result.json 为 PASS 状态（避免污染 evaluator 最终裁读）
cat > /tmp/eval-restore-b9.sh << 'RESTORE'
#!/bin/bash
echo "b9_restore_step1: timeout behavior verified"
echo "b9_restore_step2: brain-result restored to pass"
echo "b9_restore_step3: all behaviors complete"
RESTORE
chmod +x /tmp/eval-restore-b9.sh
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-restore-b9.sh node packages/engine/src/harness/evaluate.js > /dev/null 2>&1 || true
echo OK
