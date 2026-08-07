#!/usr/bin/env bash
# GP 胶水参数化 + theater 闸语境化冒烟（task d2567378）
#
# 守两件事：
#   1. migration 393 的 CHECK 枚举与 JS 侧 GP_HARNESS_TARGET_ENVIRONMENTS 不漂
#   2. theater 闸四象限与 GP payload 的回落/优先/枚举拒绝仍成立
# 集成测试（真库结构 + CHECK 拒绝 + down 可逆）走 brain-integration job，这里只跑不吃库的部分。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"

# 地板同步：EXPECTED_SCHEMA_VERSION 必须已经推到 393，否则部署会用旧 schema 跑新代码。
expected_schema="$(
  sed -n "s/.*EXPECTED_SCHEMA_VERSION = '\\([0-9]*\\)'.*/\\1/p" \
    src/selfcheck.js \
    | head -1
)"
test "$expected_schema" -ge 393

test -f migrations/393_gp_harness_glue.sql
test -f migrations/rollback/393_gp_harness_glue.down.sql

npx --no-install vitest run \
  src/__tests__/migration-393-gp-harness-glue.test.js \
  src/__tests__/golden-path-contract-task.test.js \
  src/__tests__/golden-path-contracts.test.js \
  src/__tests__/harness-judge-theater.test.js \
  src/__tests__/harness-judge.test.js \
  --reporter=dot

echo "GP_HARNESS_GLUE_SMOKE_PASS"
