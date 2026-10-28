#!/usr/bin/env bash
# Only proven source changes may use the import graph; unknown scope stays full.
quickcheck_needs_brain() {
  local path
  while IFS= read -r path; do
    case "$path" in
      ''|.dod.md|.prd.md|changes/*.md|docs/learnings/*.md) ;;
      packages/engine/*|apps/api/*|apps/dashboard/*) ;;
      *) return 0 ;;
    esac
  done <<< "$1"
  return 1
}
quickcheck_brain_scope() {
  local base="$1" changes="$2" path statuses
  [[ -n "$base" && -n "$changes" ]] || return 1
  # Fixed reviewed include/exclude roots; a future unknown config stays full.
  [[ "$(git hash-object packages/brain/vitest.config.js 2>/dev/null)" == "b15952e3b785c8c343e57cdbb5980a100755d9ee" ]] || return 1
  statuses=$(git diff --name-status "$base" HEAD) || return 1
  [[ -n "$statuses" ]] || return 1
  [[ -z "$(printf '%s\n' "$statuses" | grep -vE '^[AM][[:space:]]')" ]] || return 1
  while IFS= read -r path; do
    case "$path" in
      packages/brain/src/*.js|packages/brain/src/*.ts|packages/brain/src/*.mjs|packages/brain/src/*.cjs) ;;
      .dod.md|.prd.md|changes/*.md|docs/learnings/*.md) ;;
      .implementation-source-relations.json) node "$REPO_ROOT/scripts/lib/quickcheck-source-metadata.mjs" "$base" || return 1 ;;
      *) return 1 ;;
    esac
    [[ "$path" != *[[:space:]]* ]] || return 1
  done <<< "$changes"
  git diff --quiet && git diff --cached --quiet || return 1
  [[ -z "$(git ls-files --others --exclude-standard packages/brain)" ]] || return 1
}
quickcheck_brain_tests() {
  local binary="$1" base="$2" changes="$3" guards guard directory
  local -a guard_args=() roots=()
  if quickcheck_brain_scope "$base" "$changes"; then
    # Cover package and external test includes without visiting node_modules.
    for directory in packages/brain/src packages/brain/scripts packages/brain/tests tests; do
      [[ ! -d "$directory" ]] || roots+=("$directory")
    done
    if [[ ${#roots[@]} -gt 0 ]] && guards=$(bash "$REPO_ROOT/.github/workflows/scripts/list-fs-guard-tests.sh" --repo-relative "${roots[@]}") && [[ -n "$guards" ]]; then
      while IFS= read -r guard; do
        case "$guard" in
          packages/brain/*) guard="${guard#packages/brain/}" ;;
          tests/*) guard="../../$guard" ;;
          *) (cd packages/brain && "$binary" run); return $? ;;
        esac
        guard_args+=("$guard")
      done <<< "$guards"
      echo '[QuickCheck] Brain: affected import graph + complete fs guards'
      (cd packages/brain && "$binary" run --changed "$base" --passWithNoTests) || return $?
      (cd packages/brain && "$binary" run "${guard_args[@]}")
      return $?
    fi
  fi
  echo '[QuickCheck] Brain: full suite (scope not proven)'
  (cd packages/brain && "$binary" run)
}
