#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"
node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js');console.log('✅ harness-initiative-patrol.js exists')"
node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!c.includes('completed_at IS NULL'))process.exit(1);console.log('✅ completed_at IS NULL 查询存在')"
echo "✅ WS4 smoke 通过"
