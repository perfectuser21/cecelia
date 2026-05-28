#!/usr/bin/env bash
# WS6 smoke: harness messages API + thread_lookup status
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke] WS6 harness-messages API..."

# 1. routes/harness.js 含 /messages/ 路由
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/harness.js', 'utf8');
if (!c.includes('/messages/')) { console.error('FAIL: /messages/ 路由不存在'); process.exit(1); }
console.log('✅ /messages/ 路由已注册');
"

# 2. harness-thread-lookup.js 导出 updateHarnessThreadStatus
node -e "
const c = require('fs').readFileSync('packages/brain/src/lib/harness-thread-lookup.js', 'utf8');
if (!c.includes('updateHarnessThreadStatus')) { console.error('FAIL: updateHarnessThreadStatus 未导出'); process.exit(1); }
console.log('✅ updateHarnessThreadStatus 已导出');
"

echo "[smoke] WS6 all checks passed ✅"
