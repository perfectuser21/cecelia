#!/bin/bash
# Simplified Branch Protection Setup

set -e

REPO="ZenithJoycloud/cecelia-quality"

echo "=================================================="
echo "  Setting up Branch Protection (Simplified)"
echo "  Repo: $REPO"
echo "=================================================="
echo ""

# Main branch
echo "Setting up protection for: main"
gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/$REPO/branches/main/protection" \
    -f required_status_checks=null \
    -f enforce_admins=true \
    -f required_pull_request_reviews='{"required_approving_review_count":0}' \
    -f restrictions=null \
    -f allow_force_pushes=false \
    -f allow_deletions=false \
    && echo "✅ main protected" || echo "❌ Failed to protect main"

echo ""

# Develop branch  
echo "Setting up protection for: develop"
gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/$REPO/branches/develop/protection" \
    -f required_status_checks=null \
    -f enforce_admins=true \
    -f required_pull_request_reviews='{"required_approving_review_count":0}' \
    -f restrictions=null \
    -f allow_force_pushes=false \
    -f allow_deletions=false \
    && echo "✅ develop protected" || echo "❌ Failed to protect develop"

echo ""
echo "=================================================="
echo "  ✅ Branch Protection Applied"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. Go to: https://github.com/$REPO/settings/branches"
echo "  2. Add required status checks manually after CI runs"
echo "  3. Enable: quality-check"
echo ""
