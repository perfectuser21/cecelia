#!/bin/bash
# Stop Hook for OKR Validation (v7.0.0 with Anti-Cheat)
# Prevents:
#   1. Changing scores without changing content (hash verification)
#   2. Tampering with validation script (git diff check)
#   3. Calculation errors (arithmetic checks)
#   4. Bypassing validation (file existence checks)

set -e

REPORT_FILE="validation-report.json"
OUTPUT_FILE="output.json"
VALIDATE_SCRIPT="$HOME/.claude/skills/okr/scripts/validate-okr.py"

echo "=== OKR Stop Hook: Anti-Cheat Validation ==="

# === Pre-checks ===

# Check 1: Must be in git repository (for script integrity)
if [ ! -d ".git" ]; then
    echo "❌ ERROR: Not in a git repository"
    echo "   Anti-cheat requires git for script integrity verification"
    echo ""
    echo "   Fix: Initialize git repository or work in existing repo"
    exit 2
fi

# Check 2: Required files exist
if [ ! -f "$REPORT_FILE" ]; then
    echo "❌ No validation-report.json found"
    echo "   Run: python3 ~/.claude/skills/okr/scripts/validate-okr.py output.json"
    exit 2
fi

if [ ! -f "$OUTPUT_FILE" ]; then
    echo "❌ No output.json found"
    echo "   Generate OKR output first"
    exit 2
fi

# Check 3: Report structure complete
required_fields="form_score content_score content_breakdown total passed content_hash timestamp"
for field in $required_fields; do
    if ! jq -e ".$field" "$REPORT_FILE" >/dev/null 2>&1; then
        echo "❌ Missing field in validation report: $field"
        echo "   Re-run: python3 validate-okr.py output.json"
        exit 2
    fi
done

# Check 4: Content breakdown structure
breakdown_fields="title_quality description_quality kr_feature_mapping completeness"
for field in $breakdown_fields; do
    if ! jq -e ".content_breakdown.$field" "$REPORT_FILE" >/dev/null 2>&1; then
        echo "❌ Missing content breakdown field: $field"
        echo "   AI must fill all content_breakdown fields"
        exit 2
    fi
done

# === Anti-Cheat Checks ===

# Check 5: Content hash integrity (CRITICAL - prevents score tampering)
report_hash=$(jq -r '.content_hash' "$REPORT_FILE")
actual_hash=$(python3 -c "
import json, hashlib
with open('$OUTPUT_FILE') as f:
    data = json.load(f)
content = json.dumps(data, sort_keys=True)
print(hashlib.sha256(content.encode()).hexdigest()[:16])
")

if [ "$report_hash" != "$actual_hash" ]; then
    echo "❌ ANTI-CHEAT: Content hash mismatch!"
    echo ""
    echo "   Report hash:  $report_hash"
    echo "   Actual hash:  $actual_hash"
    echo ""
    echo "   This means validation-report.json is out of sync with output.json"
    echo "   Likely causes:"
    echo "   - Scores were changed without re-running validation"
    echo "   - output.json was modified after validation"
    echo "   - Old validation report was copied"
    echo ""
    echo "   Fix: Improve output.json and re-run validation"
    echo "        python3 ~/.claude/skills/okr/scripts/validate-okr.py output.json"
    exit 2
fi

# Check 6: Validation script integrity (prevents tampering)
# Only check if script is inside current git repo
if [ -f "$VALIDATE_SCRIPT" ]; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    SCRIPT_ABS=$(readlink -f "$VALIDATE_SCRIPT" 2>/dev/null || echo "$VALIDATE_SCRIPT")

    # Check if script is inside this git repo
    if [[ "$SCRIPT_ABS" == "$REPO_ROOT"* ]]; then
        if ! git diff --quiet "$VALIDATE_SCRIPT" 2>/dev/null; then
            echo "❌ ANTI-CHEAT: Validation script has been modified!"
            echo ""
            echo "   Git shows changes in: $VALIDATE_SCRIPT"
            echo ""
            echo "   This is not allowed. The validation script must remain"
            echo "   unchanged to ensure fair and consistent scoring."
            echo ""
            echo "   Fix: Revert changes"
            echo "        git checkout $VALIDATE_SCRIPT"
            exit 2
        fi
    fi
fi

# Check 7: Score calculation correctness
form=$(jq '.form_score' "$REPORT_FILE")
content=$(jq '.content_score' "$REPORT_FILE")
total=$(jq '.total' "$REPORT_FILE")
expected=$((form + content))

if [ "$total" -ne "$expected" ]; then
    echo "❌ ANTI-CHEAT: Score calculation error!"
    echo ""
    echo "   form_score ($form) + content_score ($content) = $expected"
    echo "   But total = $total"
    echo ""
    echo "   Fix: Update total = form_score + content_score"
    exit 2
fi

# Check 8: Content breakdown sum matches content_score
breakdown_sum=$(jq '.content_breakdown | to_entries | map(.value) | add' "$REPORT_FILE")
if [ "$breakdown_sum" -ne "$content" ]; then
    echo "❌ ANTI-CHEAT: Content breakdown sum mismatch!"
    echo ""
    echo "   Breakdown sum: $breakdown_sum"
    echo "   Content score: $content"
    echo ""
    echo "   The breakdown items must add up to content_score"
    echo ""
    echo "   Fix: Adjust content_breakdown or content_score"
    exit 2
fi

# Check 9: Individual scores within valid ranges
for field in title_quality description_quality kr_feature_mapping completeness; do
    score=$(jq ".content_breakdown.$field" "$REPORT_FILE")
    if [ "$score" -gt 15 ] || [ "$score" -lt 0 ]; then
        echo "❌ ANTI-CHEAT: Invalid score for $field"
        echo ""
        echo "   Score: $score (must be 0-15)"
        echo ""
        echo "   Fix: Adjust $field to valid range"
        exit 2
    fi
done

if [ "$form" -gt 40 ] || [ "$form" -lt 0 ]; then
    echo "❌ ANTI-CHEAT: Invalid form_score"
    echo "   Score: $form (must be 0-40)"
    exit 2
fi

if [ "$content" -gt 60 ] || [ "$content" -lt 0 ]; then
    echo "❌ ANTI-CHEAT: Invalid content_score"
    echo "   Score: $content (must be 0-60)"
    exit 2
fi

# === Business Logic Checks ===

# Check 10: Passing criteria
passed=$(jq '.passed' "$REPORT_FILE")

if [ "$passed" != "true" ]; then
    echo "❌ Validation not passed"
    echo ""
    echo "   Current score: $total/100 (need >= 90)"
    echo ""
    
    if [ $(jq '.issues | length' "$REPORT_FILE") -gt 0 ]; then
        echo "   Form issues:"
        jq -r '.issues[]' "$REPORT_FILE" | sed 's/^/     - /'
        echo ""
    fi
    
    echo "   Continue to improve output.json and re-validate"
    exit 2
fi

if [ "$total" -lt 90 ]; then
    echo "❌ Score below threshold"
    echo ""
    echo "   Total: $total < 90"
    echo "   But passed = true (inconsistent)"
    echo ""
    echo "   Fix: Set passed = false or improve score"
    exit 2
fi

# === All checks passed ===

echo ""
echo "✅ All anti-cheat checks passed"
echo ""
echo "   Validation Summary:"
echo "   ├─ Form score:       $form/40"
echo "   ├─ Content score:    $content/60"
echo "   │  ├─ Title:         $(jq '.content_breakdown.title_quality' "$REPORT_FILE")/15"
echo "   │  ├─ Description:   $(jq '.content_breakdown.description_quality' "$REPORT_FILE")/15"
echo "   │  ├─ KR Mapping:    $(jq '.content_breakdown.kr_feature_mapping' "$REPORT_FILE")/15"
echo "   │  └─ Completeness:  $(jq '.content_breakdown.completeness' "$REPORT_FILE")/15"
echo "   ├─ Total:            $total/100"
echo "   └─ Hash:             $report_hash (verified)"
echo ""
echo "✅ OKR decomposition complete and validated"
exit 0
