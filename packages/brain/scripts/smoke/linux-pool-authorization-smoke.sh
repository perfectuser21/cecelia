#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
# 测试自身强制scratch/test库，只创建随机schema；不在现网运行迁移。
npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-pool-authorization.pg.integration.test.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js --maxWorkers=1 --minWorkers=1
npx vitest run src/linux-pool/router.test.js src/linux-pool/deployment.test.js src/linux-pool/service.test.js src/linux-pool/receipt.test.js src/linux-pool/runtime-deployment.test.js src/linux-pool/runtime-receipt.test.js --maxWorkers=1 --minWorkers=1
