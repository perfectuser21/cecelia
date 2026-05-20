#!/usr/bin/env bash
# 验证：smoke script commit 满足 lint-tdd-commit-order 的外层 test-first 要求
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/lint-tdd-commit-order.sh"
PASS=0; FAIL=0

assert_pass() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (expected pass but failed)"; FAIL=$((FAIL+1))
  fi
}

assert_fail() {
  local desc="$1"; shift
  if ! "$@" >/dev/null 2>&1; then
    echo "PASS (expected fail): $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (expected fail but passed)"; FAIL=$((FAIL+1))
  fi
}

TMPDIR=$(mktemp -d)
cd "$TMPDIR"
git init -q
git config user.email "test@test.com"
git config user.name "Test"
git config commit.gpgsign false

# Create base commit on "main"
echo "base" > base.txt
git add .
git commit -q -m "base"

# Case 1: smoke commit before src commit → should PASS (smoke = outer test-first)
git checkout -q -b pr-case1
mkdir -p .github/workflows/scripts/smoke packages/brain/src
echo '#!/bin/bash' > .github/workflows/scripts/smoke/golden-path-1-test.sh
git add .
git commit -q -m "test: add golden-path smoke script"
echo "const x = 1;" > packages/brain/src/feature.js
git add .
git commit -q -m "feat: add feature"
assert_pass "smoke commit before brain/src commit → PASS" bash "$SCRIPT" "HEAD~2"

# Case 2: src commit with no test of any kind → should FAIL
git checkout -q main
git checkout -q -b pr-case2
mkdir -p packages/brain/src
echo "const y = 2;" > packages/brain/src/another.js
git add .
git commit -q -m "feat: add another feature without test"
assert_fail "brain/src commit with no test before it → FAIL" bash "$SCRIPT" "HEAD~1"

# Case 3: packages/brain/scripts/smoke path → same behavior as .github path
git checkout -q main
git checkout -q -b pr-case3
mkdir -p packages/brain/scripts/smoke
echo '#!/bin/bash' > packages/brain/scripts/smoke/golden-path-2-test.sh
git add .
git commit -q -m "test: add brain smoke script"
mkdir -p packages/brain/src
echo "const z = 3;" > packages/brain/src/yetAnother.js
git add .
git commit -q -m "feat: add yet another feature"
assert_pass "brain/scripts/smoke commit before brain/src commit → PASS" bash "$SCRIPT" "HEAD~2"

cd - >/dev/null
rm -rf "$TMPDIR"

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
