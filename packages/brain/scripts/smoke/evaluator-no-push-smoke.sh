#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
DISPATCHER="$REPO_ROOT/packages/brain/src/orchestrator/dispatcher.js"
EVALUATOR_SKILL="$REPO_ROOT/packages/workflows/skills/harness-evaluator/SKILL.md"
TEST_ROOT=$(mktemp -d /tmp/evaluator-no-push-smoke.XXXXXX)
trap 'rm -rf "$TEST_ROOT"' EXIT

grep -q "GIT_CONFIG_KEY_0 = 'remote.origin.pushurl'" "$DISPATCHER"
grep -q "GIT_CONFIG_VALUE_0 = 'blocked-by-harness://evaluator'" "$DISPATCHER"

EVALUATOR_BODY=$(sed -n '/^# \/harness-evaluator/,$p' "$EVALUATOR_SKILL")
grep -q 'Evaluator 禁止 commit/push' <<<"$EVALUATOR_BODY"
if grep -Eq '\bgit[[:space:]]+(commit|push)\b' <<<"$EVALUATOR_BODY"; then
  printf 'FAIL: evaluator skill still contains a Git write command\n' >&2
  exit 1
fi

git init --bare "$TEST_ROOT/remote.git" >/dev/null
git init "$TEST_ROOT/work" >/dev/null
git -C "$TEST_ROOT/work" config core.hooksPath /dev/null
git -C "$TEST_ROOT/work" config user.name Test
git -C "$TEST_ROOT/work" config user.email test@example.com
git -C "$TEST_ROOT/work" commit --allow-empty -m initial >/dev/null
git -C "$TEST_ROOT/work" remote add origin "$TEST_ROOT/remote.git"
git -C "$TEST_ROOT/work" push -u origin HEAD:main >/dev/null
BEFORE=$(git --git-dir="$TEST_ROOT/remote.git" rev-parse refs/heads/main)

git -C "$TEST_ROOT/work" commit --allow-empty -m blocked >/dev/null
if GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=remote.origin.pushurl \
  GIT_CONFIG_VALUE_0=blocked-by-harness://evaluator \
  git -C "$TEST_ROOT/work" push origin HEAD:main >/dev/null 2>&1; then
  printf 'FAIL: evaluator push unexpectedly succeeded\n' >&2
  exit 1
fi

AFTER=$(git --git-dir="$TEST_ROOT/remote.git" rev-parse refs/heads/main)
test "$BEFORE" = "$AFTER"
printf 'PASS: evaluator push blocked and remote SHA unchanged\n'
