#!/bin/bash
# Manual integration test for Gateway MVP
# This script demonstrates the three core flows

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Gateway MVP Integration Test ==="
echo ""

# Clean up
rm -rf queue/ state/ runs/
mkdir -p queue state runs

echo "Test 1: Manual Trigger (CloudCode → Gateway → Queue)"
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"test-manual"}'
echo "✅ Task enqueued manually"
echo ""

echo "Test 2: Check Queue Status"
bash gateway/gateway.sh status
echo ""

echo "Test 3: Worker Consumes Queue"
bash worker/worker.sh
echo "✅ Worker executed task"
echo ""

echo "Test 4: Heartbeat Auto-Trigger"
# Enqueue another task
bash gateway/gateway.sh add n8n fixBug P1 '{"project":"test-heartbeat"}'
# Heartbeat should detect and trigger worker
bash heartbeat/heartbeat.sh
echo "✅ Heartbeat detected queue and triggered worker"
echo ""

echo "Test 5: Verify Evidence"
if [[ -d "runs" ]] && [[ $(ls runs/ | wc -l) -ge 2 ]]; then
  echo "✅ Evidence generated in runs/"
  ls -la runs/
else
  echo "❌ Evidence not found"
  exit 1
fi
echo ""

echo "Test 6: Verify State Tracking"
if [[ -f "state/state.json" ]]; then
  echo "✅ State file exists"
  cat state/state.json | jq .
else
  echo "❌ State file not found"
  exit 1
fi
echo ""

echo "=== All Integration Tests Passed ✅ ==="
