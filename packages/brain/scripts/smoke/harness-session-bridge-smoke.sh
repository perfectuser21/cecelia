#!/usr/bin/env bash
# Smoke: harness-session-bridge — .cecelia-session-uuid 文件被写入 worktree
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "✅ $desc"
  else
    echo "❌ $desc"
    exit 1
  fi
}

# C1: cecelia-run.sh 含写 .cecelia-session-uuid 逻辑
check "cecelia-run.sh 含 .cecelia-session-uuid 写入" \
  grep -q "cecelia-session-uuid" "$REPO_ROOT/packages/brain/scripts/cecelia-run.sh"

# C2: harness-session-bridge.js 存在
check "harness-session-bridge.js 存在" \
  test -f "$REPO_ROOT/packages/brain/src/harness-session-bridge.js"

# C3: harness-session-bridge.js export reconnectOrSpawn
check "reconnectOrSpawn 已 export" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/harness-session-bridge.js','utf8');if(!c.includes('export async function reconnectOrSpawn'))process.exit(1)"

# C4: InitiativeState 含 planner_session 字段
check "InitiativeState 含 planner_session" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('planner_session'))process.exit(1)"

# C5: GanContractState 含 session_map 字段
check "GanContractState 含 session_map" \
  node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('session_map'))process.exit(1)"

echo ""
echo "harness-session-bridge smoke: ALL PASS"
