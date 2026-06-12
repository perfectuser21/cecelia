#!/bin/bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-legacy-b.sh << 'FIXTURE'
#!/bin/bash
echo "legacy_path_test"
exit 0
FIXTURE
chmod +x /tmp/eval-legacy-b.sh
PREV=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
LEGACY_LOG=$(EVAL_LEGACY=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-legacy-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d " ")
[ "$AFTER" -eq "$PREV" ] || { echo "FAIL: EVAL_LEGACY=1 时执行记录数量增加"; exit 1; }
echo OK
