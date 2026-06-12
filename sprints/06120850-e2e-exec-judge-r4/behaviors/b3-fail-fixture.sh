#!/bin/bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-fail-b.sh << 'FIXTURE'
#!/bin/bash
echo "DB_CONNECTION_REFUSED: localhost:5432 unreachable"
exit 1
FIXTURE
chmod +x /tmp/eval-fail-b.sh
EVAL_LOG=$(SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-fail-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "FAIL"' || { echo "FAIL: 失败型应为 FAIL"; exit 1; }
echo "$BRES" | jq -e '(.failed_step | type) == "string" and (.failed_step | length) > 0' || { echo "FAIL: failed_step 空"; exit 1; }
echo "$BRES" | jq -e '(.feedback | length) > 20' || { echo "FAIL: feedback 过短"; exit 1; }
echo OK
