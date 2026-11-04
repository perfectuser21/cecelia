#!/usr/bin/env bash
# 分支仅作为兼容入口；固定SHA请求始终检出该commit，不追随移动的分支。
set -euo pipefail
REPO_ROOT="${1:?}"; WORK_DIR="${2:?}"; BRANCH_NAME="${3:?}"; EXPECTED_SHA="${4:-}"
if [[ -n "$EXPECTED_SHA" && ! "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'expected SHA must be a full commit SHA' >&2
  exit 2
fi
git -C "$REPO_ROOT" fetch -- origin "${EXPECTED_SHA:-${BRANCH_NAME}}"
git -C "$REPO_ROOT" worktree add --detach -- "$WORK_DIR" "${EXPECTED_SHA:-origin/${BRANCH_NAME}}"
actual=$(git -C "$WORK_DIR" rev-parse HEAD)
if [[ -n "$EXPECTED_SHA" && "$actual" != "$EXPECTED_SHA" ]]; then
  echo "preview checkout mismatch: $actual != $EXPECTED_SHA" >&2
  exit 1
fi
