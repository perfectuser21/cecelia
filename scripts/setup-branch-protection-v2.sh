#!/usr/bin/env bash
# Branch Protection Setup for cecelia-quality

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

REPO="ZenithJoycloud/cecelia-quality"
BRANCHES=("main" "develop")

# 标准保护配置
STANDARD_CONFIG='{
    "required_status_checks": {
        "strict": true,
        "checks": [{"context": "quality-check"}]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": null,
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
}'

echo "=================================================="
echo "  Setting up Branch Protection"
echo "  Repo: $REPO"
echo "=================================================="
echo ""

# 修复单个分支的保护配置
fix_branch() {
    local repo=$1
    local branch=$2

    echo -n "  Setting up $branch... "

    if gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        "repos/$repo/branches/$branch/protection" \
        --input <(echo "$STANDARD_CONFIG") \
        > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        return 1
    fi
}

for BRANCH in "${BRANCHES[@]}"; do
    fix_branch "$REPO" "$BRANCH" || true
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
echo "  - Require status checks: quality-check"
echo "  - Enforce for administrators: true"
echo "  - Allow force pushes: false"
echo "  - Allow deletions: false"
echo ""
echo "Verify at:"
echo "  https://github.com/$REPO/settings/branches"
echo ""
