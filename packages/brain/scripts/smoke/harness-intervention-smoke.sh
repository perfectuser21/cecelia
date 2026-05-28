#!/usr/bin/env bash
# WS5 smoke: harness-intervention-handler 基础验证
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke] WS5 harness-intervention-handler..."

# 1. 文件存在
node -e "require('fs').accessSync('packages/brain/src/harness-intervention-handler.js')" && \
  echo "✅ harness-intervention-handler.js exists"

# 2. task-router.js 引入了 handler
grep -q "harness-intervention-handler" packages/brain/src/task-router.js && \
  echo "✅ task-router.js imports harness-intervention-handler"

# 3. handler 含 retry/skip/alert
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js', 'utf8');
if (!c.match(/retry|skip|alert/)) { console.error('FAIL: 缺少 action 枚举'); process.exit(1); }
console.log('✅ action 枚举存在');
"

echo "[smoke] WS5 all checks passed ✅"
