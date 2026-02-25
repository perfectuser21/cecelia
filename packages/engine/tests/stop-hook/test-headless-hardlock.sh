#!/usr/bin/env bash
# Test: Headless 模式下有 .dev-mode 时不能 exit 0

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: Headless Hardlock ==="

# Initialize git repo
git init -q
git config user.email "test@test.com"
git config user.name "Test"

# Create initial commit (required for git rev-parse --abbrev-ref HEAD to work)
echo "test" > README.md
git add README.md
git commit -m "init" -q

# Create test branch (to match .dev-mode)
git checkout -b test-branch -q

# Create .dev-mode file (branch matches current branch)
cat > .dev-mode << 'EOF'
dev
branch: test-branch
prd: .prd.md
started: 2026-02-08T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
retry_count: 0
EOF

# Set headless mode
export CECELIA_HEADLESS=true

echo "Testing: headless mode with .dev-mode should NOT exit 0"
echo ""

# Run stop hook
if bash /home/xx/perfect21/cecelia/engine/hooks/stop-dev.sh 2>&1; then
    echo "❌ FAIL: headless + .dev-mode returned exit 0 (should never exit 0)"
    rm -rf "$TEST_DIR"
    exit 1
else
    exit_code=$?
    if [ $exit_code -eq 0 ]; then
        echo "❌ FAIL: exit 0 (wrong)"
        rm -rf "$TEST_DIR"
        exit 1
    else
        # Any non-zero exit (2 or other error) is acceptable
        # because .dev-mode exists means task is not complete
        echo "✅ PASS: headless + .dev-mode correctly returned non-zero exit ($exit_code)"
    fi
fi

rm -rf "$TEST_DIR"
echo "✅ Test passed"
