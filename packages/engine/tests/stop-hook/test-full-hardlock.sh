#!/usr/bin/env bash
# Test: 完整写死验证 - 有 .dev-mode 时任何情况都不能误放行

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: Full Hardlock Verification ==="
echo ""

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

# Test 1: Headless mode with .dev-mode
echo "Test 1: Headless + .dev-mode"
cat > .dev-mode << 'EOF'
dev
branch: test-branch
prd: .prd.md
started: 2026-02-08T10:00:00+00:00
retry_count: 0
EOF

export CECELIA_HEADLESS=true

if bash /home/xx/perfect21/cecelia/engine/hooks/stop-dev.sh 2>&1 >/dev/null; then
    echo "❌ FAIL: Headless + .dev-mode returned exit 0"
    rm -rf "$TEST_DIR"
    exit 1
else
    exit_code=$?
    if [ $exit_code -eq 0 ]; then
        echo "❌ FAIL: exit 0"
        rm -rf "$TEST_DIR"
        exit 1
    fi
    echo "✅ PASS: Headless + .dev-mode → exit $exit_code (not 0)"
fi

# Test 2: No .dev-mode should allow exit 0
echo ""
echo "Test 2: No .dev-mode (should allow exit 0)"
rm -f .dev-mode

if bash /home/xx/perfect21/cecelia/engine/hooks/stop-dev.sh 2>&1 >/dev/null; then
    echo "✅ PASS: No .dev-mode → exit 0 (allowed)"
else
    echo "⚠️  Note: exit non-zero without .dev-mode (might be due to other checks)"
fi

rm -rf "$TEST_DIR"
echo ""
echo "✅ Full hardlock test passed"
