#!/usr/bin/env bash
# Compatibility entry: restore the locked central bundle, never copy unpinned main.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS=(
  harness-controller
  harness-planner
  harness-contract-proposer
  harness-contract-reviewer
  harness-generator
  harness-evaluator
  harness-report
  line-strategist
  capability-controller
  capability-proposer
  capability-reviewer
  capability-mapper
  workflow-authoring
)

args=(install --workspace "$REPO_ROOT")
if [[ -n "${SKILLS_SSOT_DIR:-}" ]]; then args+=(--source "$SKILLS_SSOT_DIR"); fi
python3 "$SCRIPT_DIR/skills-source.py" "${args[@]}"
for skill in "${SKILLS[@]}"; do
  test -f "$REPO_ROOT/packages/workflows/skills/$skill/SKILL.md"
done
