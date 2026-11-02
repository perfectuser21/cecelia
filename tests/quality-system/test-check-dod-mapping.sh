#!/usr/bin/env bash
# 兼容质量系统总入口；DoD 真实 CLI 回归由仓库 scripts/ci 维护。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"
node --test scripts/ci/__tests__/basic-dod-mapping.test.mjs
