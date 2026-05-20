#!/usr/bin/env bash
# 验证：PR 新增 smoke script → thin PR → lint-test-pairing 豁免（不要求 unit test 配对）
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/lint-test-pairing.sh"
PASS=0; FAIL=0

assert_pass() {
  local desc="$1"; shift
  if bash "$SCRIPT" "$@" >/dev/null 2>&1; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (expected pass but failed)"; FAIL=$((FAIL+1))
  fi
}

assert_fail() {
  local desc="$1"; shift
  if ! bash "$SCRIPT" "$@" >/dev/null 2>&1; then
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

# 在 main 上建好目录结构（确保 checkout 回 main 时目录依然存在）
mkdir -p packages/brain/src .github/workflows/scripts/smoke packages/brain/scripts/smoke
echo "base" > base.txt
echo "// placeholder" > packages/brain/src/.gitkeep
git add .
git commit -q -m "base"

# Case 1: thin PR — new smoke + new brain/src, NO test → should PASS (exempted)
git checkout -q -b thin-pr
echo '#!/bin/bash' > .github/workflows/scripts/smoke/golden-path-2-new-feature.sh
echo "module.exports = { fn: () => 'x' };" > packages/brain/src/newFeature.js
git add .
git commit -q -m "feat: add new feature skeleton"
assert_pass "thin PR (smoke + src, no test) → PASS (exempted)" "HEAD~1"

# Case 2: non-thin PR — new src, NO smoke, NO test → should FAIL (pairing enforced)
git checkout -q main
git checkout -q -b thick-pr
echo "module.exports = { other: () => 'y' };" > packages/brain/src/anotherFeature.js
git add .
git commit -q -m "feat: add another feature without test"
assert_fail "non-thin PR (src only, no smoke, no test) → FAIL" "HEAD~1"

# Case 3: packages/brain/scripts/smoke path also works
git checkout -q main
git checkout -q -b brain-smoke-pr
echo '#!/bin/bash' > packages/brain/scripts/smoke/golden-path-3-other.sh
echo "module.exports = { other2: () => 'z' };" > packages/brain/src/other2.js
git add .
git commit -q -m "feat: add other2 feature skeleton (brain smoke)"
assert_pass "thin PR with brain/scripts/smoke path → PASS (exempted)" "HEAD~1"

cd - >/dev/null
rm -rf "$TMPDIR"

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
