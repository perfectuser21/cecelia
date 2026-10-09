#!/usr/bin/env bash
# Smoke: 机器路由 ssh 直派通道在位（2026-09-15）——排单自动填机器直接下派。
set -euo pipefail
printf '%s\n' "▶️  smoke: machine-ssh-dispatch-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src"; CAND2="$SCRIPT_DIR/../../src"
if [ -d "$CAND1" ]; then SRC="$CAND1"; else SRC="$CAND2"; fi
grep -q "export function sshTargetFor" "$SRC/machine-registry.js" || { echo "❌ sshTargetFor 不在位"; exit 1; }
grep -q "dispatch?.channel === 'ssh'" "$SRC/notion-push-sync.js" || { echo "❌ ssh 直派分支不在位"; exit 1; }
grep -q "reapSshWorkflowRuns" "$SRC/notion-push-sync.js" || { echo "❌ ssh 收割器不在位"; exit 1; }
grep -q "brain-runs" "$SRC/notion-push-sync.js" || { echo "❌ exit 回执文件约定不在位"; exit 1; }
echo "✅ machine-ssh-dispatch-smoke OK"
