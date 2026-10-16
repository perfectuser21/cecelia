#!/usr/bin/env bash
# 既有联系人只读解析、鉴权及失败关闭；无生产或第三方访问。
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$TASK_ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run src/crm/contact-resolve.test.js src/crm/router.test.js \
  --maxWorkers=1 --minWorkers=1
