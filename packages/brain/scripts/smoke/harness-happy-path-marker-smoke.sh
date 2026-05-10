#!/usr/bin/env bash
# Smoke: harness happy-path marker module 真路径加载验证
#
# 验证 packages/brain/src/harness-happy-path-marker.js 在真 node runtime 下
# 能成功被 import，且 HARNESS_HAPPY_PATH_MARKER 常量与 verifyHarnessHappyPath()
# 函数返回值都匹配 child task signature 'fe91ce26-5nodes-verified'。
#
# 失败条件：
#   - module 加载失败（语法错 / 路径错）
#   - HARNESS_HAPPY_PATH_MARKER 不等于 'fe91ce26-5nodes-verified'
#   - verifyHarnessHappyPath() 返回值与常量不一致
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
MODULE_PATH="${REPO_ROOT}/packages/brain/src/harness-happy-path-marker.js"

echo "▶️  smoke: harness-happy-path-marker-smoke.sh"
echo "   module: $MODULE_PATH"

if [ ! -f "$MODULE_PATH" ]; then
  echo "❌ module file 不存在: $MODULE_PATH"
  exit 1
fi

node --input-type=module -e "
const m = await import('${MODULE_PATH}');
if (m.HARNESS_HAPPY_PATH_MARKER !== 'fe91ce26-5nodes-verified') {
  console.error('❌ HARNESS_HAPPY_PATH_MARKER mismatch:', m.HARNESS_HAPPY_PATH_MARKER);
  process.exit(1);
}
if (typeof m.verifyHarnessHappyPath !== 'function') {
  console.error('❌ verifyHarnessHappyPath is not a function');
  process.exit(1);
}
if (m.verifyHarnessHappyPath() !== m.HARNESS_HAPPY_PATH_MARKER) {
  console.error('❌ verifyHarnessHappyPath() return value mismatch');
  process.exit(1);
}
console.log('✅ marker module loaded and signature verified:', m.HARNESS_HAPPY_PATH_MARKER);
"

echo "✅ smoke pass: harness-happy-path-marker module 真路径验证通过"
