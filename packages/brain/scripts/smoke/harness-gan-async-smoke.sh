#!/usr/bin/env bash
# WS3 smoke: GAN 每轮异步化验证
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke] WS3 GAN 节点异步化..."

# 1. harness-gan.graph.js 含 spawnDockerDetached
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-gan.graph.js && \
  echo "✅ spawnDockerDetached import 存在"

# 2. proposer 不含阻塞 reconnectOrSpawn
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js', 'utf8');
const s = c.search(/async function proposer/);
if (s < 0) { console.error('FAIL: proposer 未找到'); process.exit(1); }
const fn = c.slice(s, s + 3000);
if (fn.includes('reconnectOrSpawn')) { console.error('FAIL: proposer 仍含阻塞 reconnectOrSpawn'); process.exit(1); }
console.log('✅ proposer 无阻塞 reconnectOrSpawn');
"

# 3. detectConvergenceTrend 收敛逻辑保留
grep -q "detectConvergenceTrend" packages/brain/src/workflows/harness-gan.graph.js && \
  echo "✅ detectConvergenceTrend 收敛逻辑保留"

echo "[smoke] WS3 all checks passed ✅"
