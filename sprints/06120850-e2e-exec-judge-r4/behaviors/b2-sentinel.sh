#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-sentinel-b2.sh << 'FIXTURE'
#!/bin/bash
echo "EXEC_SENTINEL_XK9W: execution_verified"
echo "EXEC_SENTINEL_XK9W: record_captured"
exit 0
FIXTURE
chmod +x /tmp/eval-sentinel-b2.sh
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-sentinel-b2.sh node packages/engine/src/harness/evaluate.js
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "PASS"' || { echo "FAIL: verdict"; exit 1; }
echo "$BRES" | jq -e '(.coverage | type) == "array" and (.coverage | length) >= 1' || { echo "FAIL: coverage 空"; exit 1; }
echo "$BRES" | jq -e '.coverage | map(.record_segment // "") | join(" ") | test("EXEC_SENTINEL_XK9W")' || { echo "FAIL: record_segment 未含 fixture 已知标记"; exit 1; }
echo OK
