#!/usr/bin/env bash
# Judge 测试包装器：委托 verify-map-reorg.sh 执行完整验收
# 文件名 *.test.sh 使 harness-judge TEST_FILE_RE 检测生效
set -euo pipefail
exec bash "$(dirname "$0")/verify-map-reorg.sh" "$@"
