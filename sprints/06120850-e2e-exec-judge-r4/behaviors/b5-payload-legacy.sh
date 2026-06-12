#!/bin/bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-payload-b.sh << 'FIXTURE'
#!/bin/bash
echo "payload_legacy_test"
exit 0
FIXTURE
chmod +x /tmp/eval-payload-b.sh
PREV_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
PAYLOAD_LOG=$(EVAL_PAYLOAD='{"use_legacy_eval":true}' SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-payload-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
[ "$AFTER_P" -eq "$PREV_P" ] || { echo "FAIL: use_legacy_eval:true payload 时执行记录数量增加"; exit 1; }
echo OK
