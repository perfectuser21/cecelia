#!/usr/bin/env bash
# 旧 vitest --changed 的 fs grep 补选器已退役；现役 basic-scope 选择完整组件。
# 保留拒绝入口，防旧调用方误以为空列表表示无需测试。
set -euo pipefail
printf '%s\n' 'list-fs-guard-tests 已退役：使用 scripts/ci/basic-scope.mjs 的整组件测试计划。' >&2
exit 64
