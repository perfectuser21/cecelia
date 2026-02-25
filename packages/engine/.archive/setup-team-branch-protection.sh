#!/bin/bash
# A+ (100%) Branch Protection for Team Organization

set -euo pipefail

source ~/.credentials/github.env
export GH_TOKEN="$GITHUB_PAT_ZENITHJOYCLOUD"

REPOS=(
    "zenithjoy-engine"
    "zenithjoy-autopilot"
    "zenithjoy-core"
)

BRANCHES=("main" "develop")

ORG="ZenithJoycloud"

for repo in "${REPOS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "配置仓库: $ORG/$repo"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    for branch in "${BRANCHES[@]}"; do
        echo ""
        echo "→ 配置分支: $branch"

        # A+ (100%) 配置
        gh api -X PUT "repos/$ORG/$repo/branches/$branch/protection" \
            --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {
        "context": "test"
      }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": {
    "users": [],
    "teams": [],
    "apps": []
  },
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

        echo "✅ $branch 已配置 A+ (100%) 保护"
    done

    echo ""
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 所有仓库已配置 A+ (100%) 保护"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "关键配置："
echo "  ✅ required_approving_review_count: 1 (必须人工审核)"
echo "  ✅ restrictions: 空 (没有人可以直接 push)"
echo "  ✅ enforce_admins: true (Admin 也必须遵守)"
echo "  ✅ required_status_checks: CI 必须通过"
echo ""
echo "保护等级: A+ (100%)"
