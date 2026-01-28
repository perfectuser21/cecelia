#!/bin/bash
# Branch Protection Setup for Cecelia Quality Platform

set -e

REPO="ZenithJoycloud/cecelia-quality"
BRANCHES=("main" "develop")

echo "=================================================="
echo "  Setting up Branch Protection"
echo "  Repo: $REPO"
echo "=================================================="
echo ""

for BRANCH in "${BRANCHES[@]}"; do
    echo "Setting up protection for: $BRANCH"
    
    gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        "/repos/$REPO/branches/$BRANCH/protection" \
        -f required_status_checks='{"strict":true,"checks":[{"context":"quality-check"}]}' \
        -f enforce_admins=true \
        -f required_pull_request_reviews='{"dismiss_stale_reviews":true,"require_code_owner_reviews":false,"required_approving_review_count":0}' \
        -f restrictions=null \
        -f required_linear_history=false \
        -f allow_force_pushes=false \
        -f allow_deletions=false \
        -f block_creations=false \
        -f required_conversation_resolution=false \
        > /dev/null 2>&1 && echo "✅ $BRANCH protected" || echo "⚠️  Failed to protect $BRANCH (may need manual setup)"
done

echo ""
echo "=================================================="
echo "  ✅ Branch Protection Setup Complete"
echo "=================================================="
echo ""
echo "Protected branches:"
for BRANCH in "${BRANCHES[@]}"; do
    echo "  - $BRANCH"
done
echo ""
echo "Rules applied:"
echo "  - Require status checks to pass (quality-check)"
echo "  - Enforce for administrators"
echo "  - No force pushes"
echo "  - No deletions"
echo ""
echo "Verify at:"
echo "  https://github.com/$REPO/settings/branches"
echo ""
