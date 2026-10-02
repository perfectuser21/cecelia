#!/usr/bin/env bash
# KR既有动态回归；验证程序行为，不执行真实Notion写入或Agent派发。
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  src/projection/__tests__/company-key-results.test.js \
  src/projection/__tests__/company-kr-inlet.test.js \
  src/projection/__tests__/company-kr-notion.test.js \
  src/lib/__tests__/company-kr-analysis.test.js \
  src/lib/__tests__/company-kr-advice.test.js \
  src/lib/__tests__/company-kr-writers.test.js \
  src/lib/__tests__/company-kr-observations.test.js \
  src/__tests__/openclaw-agent-executor.test.js \
  src/routes/__tests__/company-kr-analysis.test.js \
  --maxWorkers=1 --minWorkers=1
printf '%s\n' 'regression_only: 公司KR程序回归通过；真实业务执行状态未评估'
