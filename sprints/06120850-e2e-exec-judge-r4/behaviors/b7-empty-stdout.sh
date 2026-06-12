#!/bin/bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-empty-b.sh << 'FIXTURE'
#!/bin/bash
exit 0
FIXTURE
chmod +x /tmp/eval-empty-b.sh
EMPTY_LOG=$(SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-empty-b.sh node packages/engine/src/harness/evaluate.js 2>&1 || true)
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "FAIL"' || { echo "FAIL: 空记录应为 FAIL"; exit 1; }
echo "$BRES" | jq -r '.feedback' | grep -qi "空\|empty" || { echo "FAIL: feedback 未标注空记录原因"; exit 1; }
echo OK
