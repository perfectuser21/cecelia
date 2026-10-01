#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
# 使用真实 Git 仓库、工作区管理器、资源准入和 attempt runner。
# 采样命令与 Docker 使用测试替身，不触碰宿主服务或生产凭据。
export NODE_ENV=test
npx vitest run tests/gp/f1/step3-generator-fix-after-publish.test.js \
  tests/gp/f1/step1-quarantined-attempt-frees-slot.test.js \
  --maxWorkers=1 --minWorkers=1
