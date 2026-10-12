#!/usr/bin/env bash
# Skill业务归属：规范引用→真实只读SQL→机器字段→投影变化与故障保护。
# 真PG测试在独立schema内建夹具并自动清理；拒绝业务库，不能跳过。
set -euo pipefail
cd "$(dirname "$0")/../.."
npx vitest run --config vitest.integration.config.js \
  src/lib/__tests__/skill-business-ownership.test.js \
  src/lib/__tests__/skill-registry-notion-props.test.js \
  src/__tests__/skill-registry-projection.test.js \
  src/lib/__tests__/integration/skill-business-ownership.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
