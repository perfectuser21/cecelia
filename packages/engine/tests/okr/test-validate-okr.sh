#!/bin/bash
# Test validate-okr.py functionality
# Tests: form score calculation, hash generation, JSON output

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VALIDATE_SCRIPT="$HOME/.claude/skills/okr/scripts/validate-okr.py"
TEST_DIR=$(mktemp -d)

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "=== Testing validate-okr.py ==="
echo ""

# Test 1: Form score calculation
echo "Test 1: Form score calculation (40 points)"
cat > "$TEST_DIR/output.json" << 'EOF'
{
  "objective": "Test Objective",
  "key_results": [
    {
      "title": "KR1",
      "features": [
        {
          "title": "实现功能A",
          "description": "这是一个详细的描述，超过50个字符，用于测试描述质量评分机制。",
          "repository": "cecelia-workspace"
        },
        {
          "title": "实现功能B",
          "description": "另一个详细的描述，同样超过50个字符，确保通过形式验证。",
          "repository": "cecelia-core"
        }
      ]
    },
    {
      "title": "KR2",
      "features": [
        {
          "title": "实现功能C",
          "description": "第三个功能的详细描述，包含做什么、为什么做、怎么做的完整信息。",
          "repository": "cecelia-workspace"
        }
      ]
    }
  ]
}
EOF

cd "$TEST_DIR"
if ! python3 "$VALIDATE_SCRIPT" output.json > /tmp/validate-output.txt 2>&1; then
    echo "   ⚠️  Script exited with non-zero (expected for incomplete validation)"
fi

if [ ! -f "validation-report.json" ]; then
    echo "   ❌ FAIL: validation-report.json not generated"
    echo "   Output:"
    cat /tmp/validate-output.txt
    exit 1
fi

FORM_SCORE=$(jq '.form_score' validation-report.json)
if [ "$FORM_SCORE" -eq 40 ]; then
    echo "   ✅ PASS: Form score = 40 (perfect)"
else
    echo "   ❌ FAIL: Expected 40, got $FORM_SCORE"
    exit 1
fi

# Test 2: Hash generation
echo ""
echo "Test 2: SHA256 hash generation"
HASH=$(jq -r '.content_hash' validation-report.json)
if [ -n "$HASH" ] && [ ${#HASH} -eq 16 ]; then
    echo "   ✅ PASS: Hash generated ($HASH)"
else
    echo "   ❌ FAIL: Invalid hash ($HASH)"
    exit 1
fi

# Test 3: JSON structure
echo ""
echo "Test 3: JSON structure completeness"
REQUIRED_FIELDS="form_score content_score content_breakdown total passed content_hash timestamp issues suggestions"
MISSING_FIELDS=""
for field in $REQUIRED_FIELDS; do
    # Use 'has' instead of -e to check field existence (avoids false=exit1 issue)
    if ! jq -e "has(\"$field\")" validation-report.json >/dev/null 2>&1; then
        MISSING_FIELDS="$MISSING_FIELDS $field"
    fi
done

if [ -n "$MISSING_FIELDS" ]; then
    echo "   ❌ FAIL: Missing fields:$MISSING_FIELDS"
    echo "   Available fields:"
    jq 'keys' validation-report.json
    exit 1
else
    echo "   ✅ PASS: All required fields present"
fi

# Test 4: Script outputs data only (no suggestions in stdout)
echo ""
echo "Test 4: Script outputs data, not suggestions"
python3 "$VALIDATE_SCRIPT" output.json > /tmp/validate-output2.txt 2>&1 || true
if grep -q "OKR Validation Report" /tmp/validate-output2.txt; then
    echo "   ✅ PASS: Script outputs structured data"
else
    echo "   ❌ FAIL: Script output format incorrect"
    cat /tmp/validate-output2.txt
    exit 1
fi

echo ""
echo "=== All validate-okr.py tests PASSED ==="
