#!/usr/bin/env bash
# 毕业自 sprints/07081030-headed-r7/e2e-verify.sh（刀1 测试入册）。
# 原脚本仅转调 sprint 内 tests/smoke-verify.sh，已就地自足化：
#   - 保留 relay-demo pretty-bytes golden path CLI 断言（scripts/relay-demo 仍在库）
#   - 原 vitest 段引用的 sprint 内 pretty-bytes.contract.test.ts 已在 07-10 大扫除中删除，
#     该段无法保留（依赖文件不存在），随本次毕业移除并在 PR 记录。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT_DIR"

test "$(node scripts/relay-demo/pretty-bytes.mjs 0)" = "0 B"
test "$(node scripts/relay-demo/pretty-bytes.mjs 1024)" = "1 KB"
test "$(node scripts/relay-demo/pretty-bytes.mjs 1099511627776)" = "1 TB"

echo "OK: relay-demo pretty-bytes golden path"
