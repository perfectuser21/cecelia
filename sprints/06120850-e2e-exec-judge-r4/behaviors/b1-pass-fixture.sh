#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-pass-b.sh << 'FIXTURE'
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
