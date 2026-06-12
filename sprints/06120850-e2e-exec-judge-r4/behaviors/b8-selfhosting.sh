#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-selfhosting-b.sh << 'FIXTURE'
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
echo "$BRES" | jq -e '.verdict == "PASS"' || { echo "FAIL: self-hosting verdict 非 PASS"; exit 1; }
echo "$BRES" | jq -e '(.coverage | length) >= 5' || { echo "FAIL: self-hosting coverage 不足 5 步"; exit 1; }
echo OK
