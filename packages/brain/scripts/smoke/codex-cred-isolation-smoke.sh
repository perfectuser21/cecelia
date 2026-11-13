#!/usr/bin/env bash
# 保留现役 codex bridge 的凭据快照隔离；旧 Kernel relay 启动已退役。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRIDGE="$REPO_ROOT/packages/brain/scripts/codex-bridge/codex-bridge.cjs"

if [ ! -f "$BRIDGE" ]; then
  echo "SKIP: $BRIDGE 不存在"
  exit 0
fi

FAKE_HOME=$(node -e "console.log(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'smoke-codex-fakehome-')))")
cleanup() { rm -rf "$FAKE_HOME"; }
trap cleanup EXIT

mkdir -p "$FAKE_HOME/fake-relay-home"
cat > "$FAKE_HOME/fake-relay-home/auth.json" <<'JSON'
{"auth_mode":"chatgpt","tokens":{"access_token":"smoke_original_token","refresh_token":"smoke_rt"},"last_refresh":"2026-07-21T00:00:00Z"}
JSON

echo "🔍 codex-cred-isolation smoke — REPO_ROOT=$REPO_ROOT"

# ② codex-bridge.cjs: loadRawAuth/injectLocalAccount 真实隔离验证
mkdir -p "$FAKE_HOME/.codex-team3"
cp "$FAKE_HOME/fake-relay-home/auth.json" "$FAKE_HOME/.codex-team3/auth.json"

node -e "
const m = require('$BRIDGE');
if (typeof m.injectLocalAccount !== 'function' || typeof m.loadRawAuth !== 'function') {
  console.error('FAIL: loadRawAuth/injectLocalAccount 未导出');
  process.exit(1);
}
const fs = require('fs');
const realDir = '$FAKE_HOME/.codex-team3';
const result = m.injectLocalAccount('smoke-task-bridge', 'team3', '$FAKE_HOME');
if (result.primaryHome === realDir) {
  console.error('FAIL: injectLocalAccount 的 primaryHome 不能等于真实目录');
  process.exit(1);
}
fs.writeFileSync(result.primaryHome + '/auth.json', JSON.stringify({tokens:{access_token:'refreshed_in_process'}}));
m.cleanupTmpDir(result.tmpDir);
const realAfter = JSON.parse(fs.readFileSync(realDir + '/auth.json', 'utf8'));
if (realAfter.tokens.access_token !== 'smoke_original_token') {
  console.error('FAIL: 真实文件被污染了，隔离失败');
  process.exit(1);
}
console.log('✅ ② codex-bridge.cjs injectLocalAccount 真实隔离验证 PASS');
" || exit 1

echo "✅ codex-cred-isolation smoke 全部 PASS"
exit 0
