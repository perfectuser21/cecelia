#!/usr/bin/env bash
# 兼容诊断入口只执行现役整组件选择及精确退役合同回归。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
node --test scripts/ci/__tests__/basic-legacy-test-retirement.test.mjs
