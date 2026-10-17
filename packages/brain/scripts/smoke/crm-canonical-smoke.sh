#!/usr/bin/env bash
# 默认关闭、租户边界、分页重放及既有 Notion 页面保护；不连接生产或第三方。
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$TASK_ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/crm/notion-mapping.test.js \
  src/crm/notion-content.test.js src/crm/notion-dossier.test.js src/crm/notion-sync.test.js \
  src/crm/notion-children.test.js src/crm/router.test.js src/crm/markdown.test.js src/crm/__tests__/store.test.js src/__tests__/integration/crm-pg-ci.test.js \
  --maxWorkers=1 --minWorkers=1
