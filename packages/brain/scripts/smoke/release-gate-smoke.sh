#!/usr/bin/env bash
# release-gate-smoke.sh — 刀C Release Gate 脚本存在性 + 基本逻辑自检
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
GATE="$REPO_ROOT/scripts/ci/release-gate-check.sh"

# 1. 脚本存在且可执行
[ -f "$GATE" ] || { echo "FAIL: release-gate-check.sh 不存在"; exit 1; }
[ -x "$GATE" ] || { echo "FAIL: release-gate-check.sh 不可执行"; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 计算 2h 前
if date -v -2H +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
  TWO_H_AGO=$(date -v -2H +"%Y-%m-%dT%H:%M:%SZ")
else
  TWO_H_AGO=$(date -u -d "2 hours ago" +"%Y-%m-%dT%H:%M:%SZ")
fi

# 2. 有效绿证据 → exit 0
echo "{\"workflow_runs\":[{\"id\":1,\"status\":\"completed\",\"conclusion\":\"success\",\"created_at\":\"$TWO_H_AGO\",\"head_branch\":\"main\"}]}" \
  > "$TMP/ok.json"
RELEASE_GATE_FIXTURE_JSON="$TMP/ok.json" GITHUB_REPOSITORY="test/repo" bash "$GATE" 24 >/dev/null \
  || { echo "FAIL: 有效绿证据应 exit 0"; exit 1; }

# 3. 空记录 → exit 1（阻断）
echo '{"workflow_runs":[]}' > "$TMP/empty.json"
RELEASE_GATE_FIXTURE_JSON="$TMP/empty.json" GITHUB_REPOSITORY="test/repo" bash "$GATE" 24 >/dev/null 2>&1 \
  && { echo "FAIL: 空记录应 exit 1"; exit 1; } || true

echo "✅ release-gate-smoke 通过"
