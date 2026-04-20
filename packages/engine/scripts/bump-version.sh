#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# bump-version.sh — sync the Engine version across 5 source-of-truth files.
#
# Usage:
#   bash packages/engine/scripts/bump-version.sh <X.Y.Z>
#   bash packages/engine/scripts/bump-version.sh patch   # current +0.0.1
#   bash packages/engine/scripts/bump-version.sh minor   # current +0.1.0, patch=0
#   bash packages/engine/scripts/bump-version.sh major   # current +1.0.0, minor=0, patch=0
#
# Flags:
#   --dry-run   print what would change, don't write files
#
# Target files:
#   packages/engine/VERSION                        (whole file)
#   packages/engine/package.json                   ("version" field)
#   packages/engine/package-lock.json              ("version" fields — root + root package)
#   packages/engine/.hook-core-version             (whole file)
#   packages/engine/hooks/VERSION                  (whole file)
#   packages/engine/skills/dev/SKILL.md            (frontmatter "version:" line)
#   packages/engine/regression-contract.yaml       (top-level "version:" line)
#
# Strategy:
#   - Compute new version from current VERSION file.
#   - Back up each target to a tmp dir, apply mutations with node (cross-platform).
#   - If any step fails, restore all backups and exit non-zero.
# -----------------------------------------------------------------------------

set -euo pipefail

# Resolve repo root: prefer $REPO_ROOT; else walk up from script location
# until we find a packages/engine/VERSION sibling.
if [[ -n "${REPO_ROOT:-}" ]]; then
  REPO="$REPO_ROOT"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO="$SCRIPT_DIR"
  while [[ "$REPO" != "/" && ! -f "$REPO/packages/engine/VERSION" ]]; do
    REPO="$(dirname "$REPO")"
  done
  if [[ ! -f "$REPO/packages/engine/VERSION" ]]; then
    echo "ERROR: could not locate repo root (no packages/engine/VERSION found)" >&2
    exit 1
  fi
fi

ENGINE_DIR="$REPO/packages/engine"

VERSION_FILE="$ENGINE_DIR/VERSION"
PACKAGE_JSON="$ENGINE_DIR/package.json"
PACKAGE_LOCK="$ENGINE_DIR/package-lock.json"
HOOK_CORE_VERSION="$ENGINE_DIR/.hook-core-version"
HOOKS_VERSION="$ENGINE_DIR/hooks/VERSION"
SKILL_MD="$ENGINE_DIR/skills/dev/SKILL.md"
REGRESSION_YAML="$ENGINE_DIR/regression-contract.yaml"

# ---------- arg parsing ----------
DRY_RUN=0
BUMP_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *)
      if [[ -z "$BUMP_ARG" ]]; then
        BUMP_ARG="$arg"
      else
        echo "ERROR: unexpected argument '$arg'" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$BUMP_ARG" ]]; then
  echo "ERROR: missing version argument" >&2
  echo "Usage: $0 <X.Y.Z|major|minor|patch> [--dry-run]" >&2
  exit 1
fi

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: $VERSION_FILE not found" >&2
  exit 1
fi

CURRENT="$(tr -d '[:space:]' < "$VERSION_FILE")"
if [[ ! "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: current VERSION '$CURRENT' is not semver" >&2
  exit 1
fi

# ---------- compute new version ----------
if [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW="$BUMP_ARG"
elif [[ "$BUMP_ARG" == "patch" || "$BUMP_ARG" == "minor" || "$BUMP_ARG" == "major" ]]; then
  IFS='.' read -r MAJ MIN PAT <<< "$CURRENT"
  case "$BUMP_ARG" in
    patch) PAT=$((PAT + 1)) ;;
    minor) MIN=$((MIN + 1)); PAT=0 ;;
    major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
  esac
  NEW="$MAJ.$MIN.$PAT"
else
  echo "ERROR: invalid bump argument '$BUMP_ARG' (expected X.Y.Z or major|minor|patch)" >&2
  exit 1
fi

if [[ "$NEW" == "$CURRENT" ]]; then
  echo "No change: version already $CURRENT" >&2
  exit 0
fi

# ---------- collect target list (skip missing optional files with warn) ----------
# Phase 7.3: bash 3.2 set -u compat — 所有下游 "${TARGETS[@]}" 展开均加 +${TARGETS[@]} guard
declare -a TARGETS=()
for f in "$VERSION_FILE" "$PACKAGE_JSON" "$HOOK_CORE_VERSION" "$HOOKS_VERSION" "$SKILL_MD" "$REGRESSION_YAML"; do
  if [[ -f "$f" ]]; then
    TARGETS+=("$f")
  else
    echo "WARN: required file not found (will skip): $f" >&2
  fi
done
if [[ -f "$PACKAGE_LOCK" ]]; then
  TARGETS+=("$PACKAGE_LOCK")
else
  echo "WARN: package-lock.json not found (will skip): $PACKAGE_LOCK" >&2
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would bump engine version: $CURRENT -> $NEW"
  for f in "${TARGETS[@]+${TARGETS[@]}}"; do
    echo "[dry-run]   update: $f"
  done
  exit 0
fi

# ---------- backup ----------
BACKUP_DIR="$(mktemp -d -t bump-version-XXXXXX)"
trap 'rm -rf "$BACKUP_DIR"' EXIT

for f in "${TARGETS[@]+${TARGETS[@]}}"; do
  rel="${f#$REPO/}"
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  cp "$f" "$BACKUP_DIR/$rel"
done

restore_all() {
  echo "ERROR: update failed — restoring backups" >&2
  for f in "${TARGETS[@]+${TARGETS[@]}}"; do
    rel="${f#$REPO/}"
    if [[ -f "$BACKUP_DIR/$rel" ]]; then
      cp "$BACKUP_DIR/$rel" "$f"
    fi
  done
}

# ---------- node-based file mutations (cross-platform, no sed -i quirks) ----------
update_plain_version_file() {
  local target="$1"
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const newV = process.argv[2];
    const current = fs.readFileSync(target, "utf8");
    const trailing = current.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(target, newV + trailing);
  ' "$target" "$NEW"
}

update_package_json() {
  local target="$1"
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const newV = process.argv[2];
    const raw = fs.readFileSync(target, "utf8");
    // Preserve trailing newline + formatting — only rewrite the top-level version.
    const updated = raw.replace(
      /("version"\s*:\s*")([^"]+)(")/,
      (m, p1, _p2, p3) => p1 + newV + p3
    );
    if (updated === raw) { console.error("ERROR: no version field replaced in " + target); process.exit(1); }
    fs.writeFileSync(target, updated);
  ' "$target" "$NEW"
}

update_package_lock() {
  local target="$1"
  # package-lock.json contains many "version" fields (for deps). We only
  # want to update the root lockfile version and the root package's version.
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const newV = process.argv[2];
    const obj = JSON.parse(fs.readFileSync(target, "utf8"));
    let touched = 0;
    if (typeof obj.version === "string") { obj.version = newV; touched++; }
    if (obj.packages && obj.packages[""] && typeof obj.packages[""].version === "string") {
      obj.packages[""].version = newV; touched++;
    }
    if (touched === 0) {
      console.error("ERROR: could not find root version in package-lock.json");
      process.exit(1);
    }
    // Preserve 2-space indent (npm default) + trailing newline.
    fs.writeFileSync(target, JSON.stringify(obj, null, 2) + "\n");
  ' "$target" "$NEW"
}

update_skill_md() {
  local target="$1"
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const newV = process.argv[2];
    const raw = fs.readFileSync(target, "utf8");
    const lines = raw.split(/\r?\n/);
    // Find frontmatter block (first "---" ... second "---") within first 30 lines.
    let start = -1, end = -1;
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      if (lines[i].trim() === "---") { start = i; break; }
    }
    if (start === -1) { console.error("ERROR: no frontmatter in " + target); process.exit(1); }
    for (let i = start + 1; i < Math.min(lines.length, start + 40); i++) {
      if (lines[i].trim() === "---") { end = i; break; }
    }
    if (end === -1) { console.error("ERROR: unterminated frontmatter in " + target); process.exit(1); }
    let replaced = false;
    for (let i = start + 1; i < end; i++) {
      if (/^version:\s*/.test(lines[i])) {
        lines[i] = "version: " + newV;
        replaced = true;
        break;
      }
    }
    if (!replaced) { console.error("ERROR: no version: line in frontmatter of " + target); process.exit(1); }
    fs.writeFileSync(target, lines.join("\n"));
  ' "$target" "$NEW"
}

update_regression_yaml() {
  local target="$1"
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const newV = process.argv[2];
    const raw = fs.readFileSync(target, "utf8");
    const lines = raw.split(/\r?\n/);
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      // Top-level "version: X.Y.Z" (no leading whitespace).
      if (/^version:\s*/.test(lines[i])) {
        lines[i] = lines[i].replace(/^version:\s*[^\s#]+/, "version: " + newV);
        replaced = true;
        break;
      }
    }
    if (!replaced) { console.error("ERROR: no top-level version: in " + target); process.exit(1); }
    fs.writeFileSync(target, lines.join("\n"));
  ' "$target" "$NEW"
}

# ---------- apply ----------
if ! (
  for f in "${TARGETS[@]+${TARGETS[@]}}"; do
    case "$f" in
      "$VERSION_FILE"|"$HOOK_CORE_VERSION"|"$HOOKS_VERSION")
        update_plain_version_file "$f"
        ;;
      "$PACKAGE_JSON")
        update_package_json "$f"
        ;;
      "$PACKAGE_LOCK")
        update_package_lock "$f"
        ;;
      "$SKILL_MD")
        update_skill_md "$f"
        ;;
      "$REGRESSION_YAML")
        update_regression_yaml "$f"
        ;;
      *)
        echo "ERROR: unexpected target $f" >&2
        exit 1
        ;;
    esac
    echo "  updated: ${f#$REPO/}"
  done
); then
  restore_all
  exit 1
fi

echo "Bumped engine version: $CURRENT -> $NEW"
