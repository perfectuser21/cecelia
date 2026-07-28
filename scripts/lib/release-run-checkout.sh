#!/usr/bin/env bash
set -euo pipefail

effect_kind="${1:?effect kind required}"
repo_root="${2:?repo root required}"
script_dir="$(cd "$(dirname "$0")" && pwd)"

bash "$script_dir/release-run-guard.sh" "$effect_kind"

merge_sha="${KERNEL_RELEASE_MERGE_SHA:?KERNEL_RELEASE_MERGE_SHA required}"
[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]] \
  || { echo "ReleaseRun checkout denied: tracked worktree is dirty" >&2; exit 78; }
git -C "$repo_root" fetch --no-tags origin "$merge_sha" \
  || git -C "$repo_root" fetch --no-tags origin main
git -C "$repo_root" cat-file -e "${merge_sha}^{commit}"
git -C "$repo_root" checkout --force --detach "$merge_sha"
actual_sha="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$actual_sha" == "$merge_sha" ]] \
  || { echo "ReleaseRun checkout mismatch: $actual_sha != $merge_sha" >&2; exit 78; }
