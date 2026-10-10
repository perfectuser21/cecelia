#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"

bash -n "$REPO_ROOT/scripts/claude-launch.sh"
bash -n "$ROOT/scripts/cecelia-run.sh"
bash -n "$ROOT/scripts/cleanup-conversation-captures.sh"

node - "$ROOT" "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const [root, repo] = process.argv.slice(2);
const migration = fs.readFileSync(`${root}/migrations/360_session_provenance.sql`, 'utf8');
const capture = fs.readFileSync(`${root}/src/conversation-capture.js`, 'utf8');
const launcher = fs.readFileSync(`${repo}/scripts/claude-launch.sh`, 'utf8');
const runner = fs.readFileSync(`${root}/scripts/cecelia-run.sh`, 'utf8');
const relay = fs.readFileSync(`${root}/src/harness-skill-relay.js`, 'utf8');

for (const token of ['session_provenance', "'human'", "'machine'", 'ON CONFLICT']) {
  if (!migration.includes(token)) throw new Error(`migration missing ${token}`);
}
for (const token of [
  'WHERE session_id = ANY($1::text[])',
  'skipped_machine',
  'skipped_unregistered',
  'provenance_lookup_failed',
]) {
  if (!capture.includes(token)) throw new Error(`capture gate missing ${token}`);
}
for (const token of ['PGCONNECT_TIMEOUT=2', 'session_provenance', 'CECELIA_DISPATCH']) {
  if (!launcher.includes(token)) throw new Error(`launcher missing ${token}`);
}
// cecelia-run.sh 的 --dry-run 仍渲染机器派发命令行（契约测试用），机器身份标记不能丢。
for (const token of ['CECELIA_DISPATCH=1', 'HARNESS_TASK_ID=', 'claude-launch.sh']) {
  if (!runner.includes(token)) throw new Error(`dispatch path missing ${token}`);
}
// relay 原本经 claude-launch.sh 拉起 claude 并注入 CECELIA_DISPATCH=1，让采集闸认出机器会话。
// Claude 无头通道已退役（任务 76a160b3，决策 067867c8）：relay 不再拉起 claude，也就不再产生需要
// 标记的 claude 机器会话（未登记会话由采集闸 skipped_unregistered fail-closed 兜住）。改为证明退役。
if (relay.includes('claude-launch.sh')) throw new Error('relay still launches claude-launch.sh');
if (!/if \(relayExecutor === 'claude'[\s\S]{0,400}?return \{ ok: false, mode: RELAY_FLAG, error: CLAUDE_CHANNEL_RETIRED_CODE \}/.test(relay)) {
  throw new Error('relay does not reject claude executor with claude_channel_retired');
}
NODE

# cecelia-run.sh 非 --dry-run 调用必须立刻拒绝（不拉起 claude、不产生机器会话）
set +e
RUN_ERR="$(bash "$ROOT/scripts/cecelia-run.sh" 2>&1 >/dev/null)"
RUN_RC=$?
set -e
if [[ "$RUN_RC" -eq 0 || "$RUN_ERR" != *claude_channel_retired* ]]; then
  echo "FAIL: cecelia-run.sh 未以 claude_channel_retired 拒绝（rc=${RUN_RC}）: ${RUN_ERR}" >&2
  exit 1
fi

node - "$ROOT" <<'NODE'
const fs = require('fs');
const [root] = process.argv.slice(2);
const cleanup = fs.readFileSync(`${root}/scripts/cleanup-conversation-captures.sh`, 'utf8');
if (!cleanup.includes('--confirm') || !cleanup.includes("DELETE FROM captures WHERE source LIKE 'conversation%'")) {
  throw new Error('cleanup SOP guard/scope missing');
}
NODE

echo "OK: conversation capture human gate smoke passed"
