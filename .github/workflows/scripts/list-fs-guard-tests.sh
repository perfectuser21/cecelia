#!/usr/bin/env bash
# list-fs-guard-tests.sh — 列出 "fs 读取型守卫测试" 文件（SSOT）
#
# 背景（#3506 / 2026-07-02 两次应验）：
#   brain-ci 的 PR 快速通道用 `vitest --changed`，只跑 *静态 import 依赖图* 命中的测试。
#   但大量守卫测试用 fs.readFileSync 在 **运行时** 读取源/脚本文件做断言（例如读 server.js
#   grep 某常量）。这类 "被读文件" 不在测试的 import 图里 —— 改动被读文件时，vitest --changed
#   不会选中该守卫测试 => 漏跑 => 守卫失效却无人察觉。
#
# 修法：CI 在 changed 模式下，除 --changed 选中的测试外，**强制附加**本脚本列出的守卫组全跑。
#   自动检测（grep readFileSync 标记）而非手维护名单 —— 新增 fs 读取型测试自动纳入，永不遗漏。
#
# 用法：
#   list-fs-guard-tests.sh [TEST_DIR]
#     TEST_DIR 默认 packages/brain/src/__tests__
#   输出：每行一个测试文件路径（相对 packages/brain，供 `cd packages/brain && npx vitest run <路径>` 直接消费）
#
# 由 .github/workflows/ci.yml brain-unit 步骤 与
#    .github/workflows/scripts/__tests__/list-fs-guard-tests.test.sh 共同消费（单一事实源）。
set -euo pipefail

TEST_DIR="${1:-packages/brain/src/__tests__}"

if [ ! -d "$TEST_DIR" ]; then
  echo "list-fs-guard-tests: 测试目录不存在: $TEST_DIR" >&2
  exit 1
fi

# 标记：任意形式的 fs 文件读取（同步/异步/解构导入后调用）。
#   readFileSync( | fs.readFile( | promises.readFile( | .readFileSync(
# 命中即视为 "运行时读文件" 守卫，纳入强制全跑组。
MARKER='readFileSync|readFile\('

# 排除 integration（brain-unit 步骤本身也 --exclude 它）。
# 路径统一裁成相对 packages/brain（vitest 从 packages/brain 目录运行）。
grep -rlE "$MARKER" "$TEST_DIR" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts|cjs|mjs)$' \
  | grep -v '/integration/' \
  | sed -E 's#^packages/brain/##' \
  | LC_ALL=C sort -u
