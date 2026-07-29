#!/usr/bin/env bash
# Sprint 级别验收测试代理脚本（*.test.sh 命名使 judge 可发现）
# 委托给 packages/engine/tests/integrity/ 下的实际契约测试
set -euo pipefail
exec bash packages/engine/tests/integrity/ci-blindspot-contract.test.sh
