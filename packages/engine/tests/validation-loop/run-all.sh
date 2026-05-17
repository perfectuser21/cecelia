#!/usr/bin/env bash
# Run all validation-loop tests

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Validation Loop Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Make all test scripts executable
chmod +x "$SCRIPT_DIR"/test-*.sh

FAILED=0

# Run each test
for test in "$SCRIPT_DIR"/test-*.sh; do
    if [[ "$(basename "$test")" == "run-all.sh" ]]; then
        continue
    fi

    echo "Running: $(basename "$test")"
    if bash "$test"; then
        echo ""
    else
        echo "❌ Test failed: $(basename "$test")"
        FAILED=$((FAILED + 1))
        echo ""
    fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo "✅ All tests passed"
else
    echo "❌ $FAILED test(s) failed"
    exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
