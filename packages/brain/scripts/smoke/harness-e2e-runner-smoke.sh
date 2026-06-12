#!/usr/bin/env bash
# harness-e2e-runner-smoke.sh
# 验证 harness-e2e-runner.js 模块导出 + 基本执行逻辑。
# 要求：Brain 已在 localhost:5221 运行（real-env smoke）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "=== harness-e2e-runner smoke ==="

echo "Step 1: 验证 harness-e2e-runner.js 模块可 import 且 runE2eScriptCommands 已导出"
(cd packages/brain && node -e "
import('./src/harness-e2e-runner.js').then(function(m) {
  if (typeof m.runE2eScriptCommands !== 'function') {
    console.error('FAIL: runE2eScriptCommands not exported');
    process.exit(1);
  }
  if (typeof m.runAndRecordE2eCommands !== 'function') {
    console.error('FAIL: runAndRecordE2eCommands not exported');
    process.exit(1);
  }
  console.log('OK: runE2eScriptCommands + runAndRecordE2eCommands exported');
}).catch(function(e) {
  console.error('FAIL:', e.message);
  process.exit(1);
})")

echo "Step 2: 执行 echo 命令，验证 exitCode=0 + stdout 采集"
(cd packages/brain && node -e "
import('./src/harness-e2e-runner.js').then(async function(m) {
  const result = await m.runE2eScriptCommands('echo smoke-ok', {});
  if (result.commands.length !== 1) {
    console.error('FAIL: expected 1 command, got', result.commands.length);
    process.exit(1);
  }
  if (result.commands[0].exitCode !== 0) {
    console.error('FAIL: exitCode', result.commands[0].exitCode);
    process.exit(1);
  }
  if (!result.commands[0].stdout.includes('smoke-ok')) {
    console.error('FAIL: stdout missing smoke-ok:', result.commands[0].stdout);
    process.exit(1);
  }
  console.log('OK: exitCode=0, stdout captured');
}).catch(function(e) {
  console.error('FAIL:', e.message);
  process.exit(1);
})")

echo "Step 3: 验证 Brain API 可达（harness 依赖 Brain 运行时）"
curl -sf http://localhost:5221/api/brain/health | node -e "
const d = require('fs').readFileSync('/dev/stdin','utf8');
const j = JSON.parse(d);
if (!j.status || j.status !== 'ok') {
  console.error('FAIL: brain health unexpected:', d.slice(0,200));
  process.exit(1);
}
console.log('OK: Brain health ok');
"

echo "✅ harness-e2e-runner smoke 全部通过"
