#!/usr/bin/env bash
# Regression: production run d9785137 / Attempt 3aa00156.
# The task pinned payload.base_sha=0dc4e3c0 for a blind A/B comparison and
# forbade read_or_copy_other_candidate, but harness-generator v7.11.0 Step 0.5
# unconditionally rebased onto origin/main, which already carried the competing
# One-session candidate (#1577). Nothing in the Runner could stop the push.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'chmod -R u+w "$TEST_ROOT" 2>/dev/null || true; rm -rf "$TEST_ROOT"' EXIT

guard_block="$(
  sed -n \
    '/^# frozen-baseline-guard:start$/,/^# frozen-baseline-guard:end$/p' \
    "$ENTRYPOINT"
)"

if [[ -z "$guard_block" ]]; then
  echo "missing frozen baseline guard implementation" >&2
  exit 1
fi

eval "$guard_block"
for fn in install_frozen_baseline_guard assert_frozen_baseline_lineage; do
  type "$fn" >/dev/null 2>&1 || {
    echo "missing $fn function" >&2
    exit 1
  }
done

grep -Fq 'if ! install_frozen_baseline_guard; then' "$ENTRYPOINT" || {
  echo "provider path does not arm the frozen baseline guard before execution" >&2
  exit 1
}
grep -Fq 'if ! assert_frozen_baseline_lineage; then' "$ENTRYPOINT" || {
  echo "provider success path does not re-assert the frozen baseline lineage" >&2
  exit 1
}

new_case() {
  local name="$1"
  local case_root="$TEST_ROOT/$name"
  mkdir -p "$case_root"
  git init --bare "$case_root/remote.git" >/dev/null
  git init -b main "$case_root/workspace" >/dev/null
  git -C "$case_root/workspace" config user.name 'Frozen Baseline Test'
  git -C "$case_root/workspace" config user.email 'frozen@example.invalid'
  # Neutralize any inherited global core.hooksPath so the fixture only ever runs
  # the hook this guard installs.
  git -C "$case_root/workspace" config core.hooksPath /dev/null
  git -C "$case_root/workspace" remote add origin "$case_root/remote.git"
  printf '%s\n' 'frozen baseline' > "$case_root/workspace/README.md"
  git -C "$case_root/workspace" add README.md
  git -C "$case_root/workspace" commit -m 'chore: frozen baseline' >/dev/null
  printf '%s' "$case_root"
}

commit_on_top() {
  local workspace="$1"
  local marker="$2"
  printf '%s\n' "$marker" > "$workspace/$marker.txt"
  git -C "$workspace" add "$marker.txt"
  git -C "$workspace" commit -m "feat: $marker" >/dev/null
}

# ── 1. Legitimate append on top of the frozen start SHA still pushes ─────────
CASE="$(new_case legit)"
WS="$CASE/workspace"
START_SHA="$(git -C "$WS" rev-parse HEAD)"

HARNESS_FROZEN_BASELINE=true \
HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  install_frozen_baseline_guard

test "$(git -C "$WS" config core.hooksPath)" = "$CASE/guard/hooks"
test -x "$CASE/guard/hooks/pre-push"

git -C "$WS" checkout -b cp-08022012-frozen-candidate >/dev/null 2>&1
commit_on_top "$WS" red
commit_on_top "$WS" green
git -C "$WS" push origin HEAD:refs/heads/cp-08022012-frozen-candidate >/dev/null 2>&1

HARNESS_FROZEN_BASELINE=true \
HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  assert_frozen_baseline_lineage

# ── 2. Exactly the production shape: main moved past the frozen baseline ─────
# 0dc4e3c0 (start) → 676fed7d (main, now carrying the competing candidate).
# `git merge-base --is-ancestor start HEAD` still holds after rebasing onto that
# main, so ancestry alone proves nothing — the guard must reject the imported
# commits themselves.
CASE="$(new_case rebase)"
WS="$CASE/workspace"
START_SHA="$(git -C "$WS" rev-parse HEAD)"

git -C "$WS" checkout -b other-candidate >/dev/null 2>&1
commit_on_top "$WS" one-session
git -C "$WS" push origin HEAD:refs/heads/main >/dev/null 2>&1
git -C "$WS" checkout main >/dev/null 2>&1
git -C "$WS" reset --hard "$START_SHA" >/dev/null 2>&1

HARNESS_FROZEN_BASELINE=true \
HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  install_frozen_baseline_guard

git -C "$WS" checkout -b cp-08022012-candidate >/dev/null 2>&1
commit_on_top "$WS" kernel

# 2a. No false positive: main having moved on is not by itself a violation.
git -C "$WS" push origin HEAD:refs/heads/cp-08022012-candidate >/dev/null 2>&1
HARNESS_FROZEN_BASELINE=true \
HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  assert_frozen_baseline_lineage

# 2b. Step 0.5 v7.11.0 behaviour: rebase onto the contaminated main.
git -C "$WS" fetch origin main >/dev/null 2>&1
git -C "$WS" rebase origin/main >/dev/null 2>&1
git -C "$WS" merge-base --is-ancestor "$START_SHA" HEAD || {
  echo "fixture is wrong: the rebase should preserve plain ancestry" >&2
  exit 1
}

if git -C "$WS" push origin HEAD:refs/heads/cp-08022012-contaminated >/dev/null 2>&1; then
  echo "frozen baseline guard let a rebased-onto-latest-main candidate push" >&2
  exit 1
fi

# --no-verify skips hooks by design; the post-Provider assertion is the backstop
# that turns the whole Attempt into a failure the callback cannot project.
git -C "$WS" push --no-verify origin HEAD:refs/heads/cp-08022012-noverify >/dev/null 2>&1 || true
if HARNESS_FROZEN_BASELINE=true \
  HARNESS_WORKSPACE_START_SHA="$START_SHA" \
  WORKTREE_PATH="$WS" \
  FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
    assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "frozen baseline assertion accepted an imported lineage" >&2
  exit 1
fi

# ── 3. A workspace that already left the start SHA never arms, it fails ──────
CASE="$(new_case drifted)"
WS="$CASE/workspace"
START_SHA="$(git -C "$WS" rev-parse HEAD)"
commit_on_top "$WS" drift

if HARNESS_FROZEN_BASELINE=true \
  HARNESS_WORKSPACE_START_SHA="$START_SHA" \
  WORKTREE_PATH="$WS" \
  FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
    install_frozen_baseline_guard >/dev/null 2>&1; then
  echo "frozen baseline guard armed on a workspace that did not start at the pinned SHA" >&2
  exit 1
fi

# ── 4. Uncanonical start SHA fails closed instead of silently disarming ──────
CASE="$(new_case uncanonical)"
WS="$CASE/workspace"

if HARNESS_FROZEN_BASELINE=true \
  HARNESS_WORKSPACE_START_SHA='origin/main' \
  WORKTREE_PATH="$WS" \
  FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
    install_frozen_baseline_guard >/dev/null 2>&1; then
  echo "frozen baseline guard accepted an uncanonical start SHA" >&2
  exit 1
fi

# ── 5. Ordinary dev keeps the latest-main rebase and pushes unchanged ────────
CASE="$(new_case ordinary-dev)"
WS="$CASE/workspace"
START_SHA="$(git -C "$WS" rev-parse HEAD)"

git -C "$WS" checkout -b other-candidate >/dev/null 2>&1
commit_on_top "$WS" upstream
git -C "$WS" push origin HEAD:refs/heads/main >/dev/null 2>&1
git -C "$WS" checkout main >/dev/null 2>&1

HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  install_frozen_baseline_guard

test "$(git -C "$WS" config --get core.hooksPath)" = '/dev/null'
test ! -e "$CASE/guard/hooks/pre-push"

git -C "$WS" checkout -b cp-08022012-ordinary >/dev/null 2>&1
commit_on_top "$WS" feature
git -C "$WS" fetch origin main >/dev/null 2>&1
git -C "$WS" rebase origin/main >/dev/null 2>&1
git -C "$WS" push origin HEAD:refs/heads/cp-08022012-ordinary >/dev/null 2>&1

HARNESS_WORKSPACE_START_SHA="$START_SHA" \
WORKTREE_PATH="$WS" \
FROZEN_BASELINE_GUARD_DIR="$CASE/guard" \
  assert_frozen_baseline_lineage

echo "entrypoint frozen baseline guard tests passed"
