#!/usr/bin/env bash

# Populate an existing worktree node_modules directory with symlinks to the
# corresponding main-worktree dependencies. Existing cache entries are kept.
link_missing_node_modules() {
  local source_dir="$1"
  local target_dir="$2"
  local dependency dependency_name

  [[ -d "$source_dir" ]] || return 0
  mkdir -p "$target_dir"

  while IFS= read -r -d '' dependency; do
    dependency_name="${dependency##*/}"
    if [[ ! -e "$target_dir/$dependency_name" && ! -L "$target_dir/$dependency_name" ]]; then
      ln -s "$dependency" "$target_dir/$dependency_name"
    fi
  done < <(find "$source_dir" -mindepth 1 -maxdepth 1 -print0)
}

resolve_package_vitest() {
  local root_modules="$1"
  local package_modules="$2"

  if [[ -x "$package_modules/.bin/vitest" ]]; then
    printf '%s\n' "$package_modules/.bin/vitest"
  elif [[ -x "$root_modules/.bin/vitest" ]]; then
    printf '%s\n' "$root_modules/.bin/vitest"
  else
    return 1
  fi
}

classify_vitest_exit() {
  local exit_code="$1"
  [[ "$exit_code" -eq 0 ]]
}
