#!/bin/bash
# Test stop-okr.sh anti-cheat mechanisms
# Tests: 10 layers of cheat prevention

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
STOP_HOOK="$HOME/.claude/hooks/stop-okr.sh"
TEST_DIR=$(mktemp -d)

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "=== Testing stop-okr.sh Anti-Cheat ==="
echo ""

# Setup git repo (required by stop hook)
cd "$TEST_DIR"
git init -q
git config user.email "test@test.com"
git config user.name "Test"

# Create valid output.json (need 2+ KRs for 40/40 form score)
cat > output.json << 'EOF'
{
  "objective": "Test",
  "key_results": [
    {
      "title": "KR1",
      "features": [
        {"title": "实现A", "description": "详细描述超过50字，确保通过验证机制的基本要求。", "repository": "test"}
      ]
    },
    {
      "title": "KR2",
      "features": [
        {"title": "实现B", "description": "另一个详细描述超过50字，确保通过验证。", "repository": "test"}
      ]
    }
  ]
}
EOF

# Generate valid report
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1

# Update to passing score
jq '.content_score = 52 | .content_breakdown = {"title_quality": 14, "description_quality": 13, "kr_feature_mapping": 14, "completeness": 11} | .total = 92 | .passed = true' validation-report.json > tmp.json
mv tmp.json validation-report.json

# Test 1: Valid case should pass
echo "Test 1: Valid case (should exit 0)"
if bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 0 for valid case"
else
    echo "   ❌ FAIL: Should exit 0"
    exit 1
fi

# Test 2: Missing validation report
echo ""
echo "Test 2: Missing validation-report.json (should exit 2)"
rm validation-report.json
if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 when report missing"
else
    echo "   ❌ FAIL: Should exit 2"
    exit 1
fi

# Restore report
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1
jq '.content_score = 52 | .content_breakdown = {"title_quality": 14, "description_quality": 13, "kr_feature_mapping": 14, "completeness": 11} | .total = 92 | .passed = true' validation-report.json > tmp.json
mv tmp.json validation-report.json

# Test 3: Hash mismatch (changed content without re-validation)
echo ""
echo "Test 3: Hash mismatch detection (should exit 2)"
OLD_HASH=$(jq -r '.content_hash' validation-report.json)
echo '{"objective":"changed"}' > output.json
if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 on hash mismatch"
else
    echo "   ❌ FAIL: Should detect hash mismatch"
    exit 1
fi

# Restore
cat > output.json << 'EOF'
{
  "objective": "Test",
  "key_results": [
    {
      "title": "KR1",
      "features": [
        {"title": "实现A", "description": "详细描述超过50字，确保通过验证机制的基本要求。", "repository": "test"}
      ]
    },
    {
      "title": "KR2",
      "features": [
        {"title": "实现B", "description": "另一个详细描述超过50字，确保通过验证。", "repository": "test"}
      ]
    }
  ]
}
EOF

# Test 4: Score calculation error
echo ""
echo "Test 4: Score calculation error (should exit 2)"
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1
jq '.content_score = 52 | .content_breakdown = {"title_quality": 14, "description_quality": 13, "kr_feature_mapping": 14, "completeness": 11} | .total = 999 | .passed = true' validation-report.json > tmp.json
mv tmp.json validation-report.json
if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 on calculation error"
else
    echo "   ❌ FAIL: Should detect calculation error"
    exit 1
fi

# Test 5: Breakdown sum mismatch
echo ""
echo "Test 5: Breakdown sum mismatch (should exit 2)"
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1
jq '.content_score = 60 | .content_breakdown = {"title_quality": 10, "description_quality": 10, "kr_feature_mapping": 10, "completeness": 10} | .total = 100 | .passed = true' validation-report.json > tmp.json
mv tmp.json validation-report.json
if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 on breakdown mismatch (40 ≠ 60)"
else
    echo "   ❌ FAIL: Should detect breakdown sum error"
    exit 1
fi

# Test 6: Below threshold
echo ""
echo "Test 6: Score below threshold (should exit 2)"
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1
jq '.content_score = 30 | .content_breakdown = {"title_quality": 8, "description_quality": 7, "kr_feature_mapping": 8, "completeness": 7} | .total = 70 | .passed = false' validation-report.json > tmp.json
mv tmp.json validation-report.json
if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 when score < 90"
else
    echo "   ❌ FAIL: Should reject low score"
    exit 1
fi

# Test 7: Git environment check (CRITICAL - fix for git bypass vulnerability)
echo ""
echo "Test 7: Non-git directory rejection (should exit 2)"
NON_GIT_DIR=$(mktemp -d)
cd "$NON_GIT_DIR"
cat > output.json << 'EOF'
{"objective":"Test","key_results":[{"title":"KR","features":[{"title":"F","description":"desc","repository":"r"}]}]}
EOF
python3 "$HOME/.claude/skills/okr/scripts/validate-okr.py" output.json > /dev/null 2>&1
jq '.content_score = 52 | .content_breakdown = {"title_quality": 14, "description_quality": 13, "kr_feature_mapping": 14, "completeness": 11} | .total = 92 | .passed = true' validation-report.json > tmp.json
mv tmp.json validation-report.json

if ! bash "$STOP_HOOK" > /dev/null 2>&1; then
    echo "   ✅ PASS: Exit 2 in non-git directory"
else
    echo "   ❌ FAIL: Should require git repository"
    exit 1
fi
rm -rf "$NON_GIT_DIR"

echo ""
echo "=== All stop-okr.sh anti-cheat tests PASSED ==="
