#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/check-agents-rules-sync.sh"

echo "========================================"
echo "  Smoke: check-agents-rules-sync.sh"
echo "========================================"

if [[ ! -f "$SCRIPT" ]]; then
  echo "FAILED: $SCRIPT not found"
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# Scenario 1: matching content
cat > "$WORKDIR/a-sync.md" <<'CONTENT'
noise before
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
noise after
CONTENT

cp "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md"

if bash "$SCRIPT" "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md" > "$WORKDIR/sync.log" 2>&1; then
  echo "PASS: Scenario 1 - matching content"
else
  echo "FAIL: Scenario 1 - should have exit 0"
  cat "$WORKDIR/sync.log"
  exit 1
fi

# Scenario 2: mismatched content
cat > "$WORKDIR/a-drift.md" <<'CONTENT'
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
CONTENT

cat > "$WORKDIR/b-drift.md" <<'CONTENT'
<!-- HARD_RULES:BEGIN -->
1. 规则一（被人手动改过）
2. 规则二
<!-- HARD_RULES:END -->
CONTENT

set +e
bash "$SCRIPT" "$WORKDIR/a-drift.md" "$WORKDIR/b-drift.md" > "$WORKDIR/drift.log" 2>&1
drift_exit_code=$?
set -e

if [[ "$drift_exit_code" -eq 0 ]]; then
  echo "FAIL: Scenario 2 - expected non-zero exit"
  cat "$WORKDIR/drift.log"
  exit 1
fi

if ! grep -q "不一致" "$WORKDIR/drift.log"; then
  echo "FAIL: Scenario 2 - missing '不一致' in output"
  cat "$WORKDIR/drift.log"
  exit 1
fi

echo "PASS: Scenario 2 - mismatch detection"

# Scenario 3: check real files
if bash "$SCRIPT" "$REPO_ROOT/.claude/CLAUDE.md" "$REPO_ROOT/AGENTS.md" > "$WORKDIR/real.log" 2>&1; then
  echo "PASS: Scenario 3 - real files in sync"
else
  echo "FAIL: Scenario 3 - real files out of sync"
  cat "$WORKDIR/real.log"
  exit 1
fi

echo "✅ All scenarios passed"
