#!/bin/bash
# Run all OKR tests

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "======================================"
echo "  OKR Skill v7.0.0 Test Suite"
echo "======================================"
echo ""

# Test 1: validate-okr.py functionality
echo "Running: test-validate-okr.sh"
bash "$SCRIPT_DIR/test-validate-okr.sh"
echo ""

# Test 2: stop-okr.sh anti-cheat
echo "Running: test-stop-okr.sh"
bash "$SCRIPT_DIR/test-stop-okr.sh"
echo ""

# Test 3: Comprehensive cheating prevention
echo "Running: test-cheating-prevention.sh"
bash "$SCRIPT_DIR/test-cheating-prevention.sh"
echo ""

echo "======================================"
echo "  ✅ ALL TESTS PASSED"
echo "======================================"
