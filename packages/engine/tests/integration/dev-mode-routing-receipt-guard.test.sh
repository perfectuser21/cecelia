#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/packages/engine/hooks/dev-mode-tool-guard.sh"
grep -q 'routing_receipt_id' "$HOOK"
grep -q '/api/brain/work-routing/validate' "$HOOK"
grep -q 'exit 2' "$HOOK"
echo 'dev mode routing receipt guard PASS'
