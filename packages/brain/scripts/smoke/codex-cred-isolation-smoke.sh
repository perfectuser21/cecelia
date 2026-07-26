#!/usr/bin/env bash
# Smoke: codex-cred-isolation — 验证 codex 凭据"先快照再用"真实隔离效果
#
# 背景：codex-request.sh 单一写者改造(PR #4159)只堵住了西安交互式借用 team1 这条路径。
# Brain 自己派发任务时还有两条内部路径会直接对真实 ~/.codex-teamN/auth.json 写：
#   ① harness-skill-relay.js 把 CODEX_RELAY_HOME 以 :rw 挂进 codex 容器（team1）
#   ② codex-bridge.cjs 降级模式直接用真实 codexHome 跑 codex（team3/4/5）
# 两处都改成"先快照到一次性临时目录再用"，本 smoke 用真实文件系统操作验证隔离
# 效果确实成立：容器/进程内不管怎么写临时目录，都碰不到真实持久文件。
#
# 验证点：
#   1. harness-skill-relay.js 导出 snapshotCodexRelayHome，真实复制 auth.json 到
#      独立临时目录，返回路径不等于源目录
#   2. codex-bridge.cjs 导出 loadRawAuth/injectLocalAccount，同样真实隔离
#   3. 两处：往"快照"里写新内容后，真实源文件保持原样不变
#
# 退出码：0 = PASS/SKIP，1 = FAIL
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RELAY="$REPO_ROOT/packages/brain/src/harness-skill-relay.js"
BRIDGE="$REPO_ROOT/packages/brain/scripts/codex-bridge/codex-bridge.cjs"

if [ ! -f "$RELAY" ] || [ ! -f "$BRIDGE" ]; then
  echo "SKIP: $RELAY 或 $BRIDGE 不存在"
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

# ① harness-skill-relay.js: snapshotCodexRelayHome 真实隔离验证
node --experimental-vm-modules -e "
process.env.CODEX_RELAY_SNAPSHOT_ROOT = '$FAKE_HOME/relay-snapshots';
import('$RELAY').then(async (m) => {
  if (typeof m.snapshotCodexRelayHome !== 'function' || typeof m.cleanupCodexRelayHome !== 'function') {
    console.error('FAIL: snapshot/cleanup helper 未导出');
    process.exit(1);
  }
  const fs = require('fs');
  const realDir = '$FAKE_HOME/fake-relay-home';
  const containerId = 'cecelia-relay-deadbeef-cx-1234abcd';
  const expectedDir = process.env.CODEX_RELAY_SNAPSHOT_ROOT + '/' + containerId;
  const dir = m.snapshotCodexRelayHome(realDir, containerId);
  if (dir !== expectedDir) {
    console.error('FAIL: 快照目录没有使用宿主可见根或完整 container ID:', dir);
    process.exit(1);
  }
  const snapshotAuth = JSON.parse(fs.readFileSync(dir + '/auth.json', 'utf8'));
  if (snapshotAuth.tokens.access_token !== 'smoke_original_token') {
    console.error('FAIL: 快照内容跟真实文件不一致');
    process.exit(1);
  }
  // 模拟容器内 codex 自刷新，写坏快照
  fs.writeFileSync(dir + '/auth.json', JSON.stringify({tokens:{access_token:'refreshed_in_container'}}));
  if (!m.cleanupCodexRelayHome(containerId) || fs.existsSync(dir)) {
    console.error('FAIL: exact cleanup 没有删除当前 run 快照');
    process.exit(1);
  }
  const realAfter = JSON.parse(fs.readFileSync(realDir + '/auth.json', 'utf8'));
  if (realAfter.tokens.access_token !== 'smoke_original_token') {
    console.error('FAIL: 真实文件被污染了，隔离失败');
    process.exit(1);
  }
  console.log('✅ ① harness-skill-relay.js snapshotCodexRelayHome 真实隔离验证 PASS');
}).catch(err => { console.error('FAIL: 模块加载失败:', err.message); process.exit(1); });
" || exit 1

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
