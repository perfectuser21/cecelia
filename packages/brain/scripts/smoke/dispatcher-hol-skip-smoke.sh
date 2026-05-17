#!/usr/bin/env bash
# Smoke: dispatcher-hol-skip — HOL blocking fix (P1 B5)
# 验证：
#   1. dispatcher.js 含 MAX_SKIP_HEAD_FOR_BLOCKED 常量
#   2. dispatcher.js 含 holSkipIds 变量
#   3. dispatcher.js 含 hol_skip_cap_exceeded 错误码
#   4. dispatcher.js 含 HOL skip 日志前缀
set -euo pipefail

echo "[hol-skip-smoke] 1. dispatcher.js 含 HOL blocking fix 关键标识"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatcher.js', 'utf8');
const checks = [
  ['MAX_SKIP_HEAD_FOR_BLOCKED', 'HOL skip cap 常量'],
  ['holSkipIds', 'HOL skip ID 列表'],
  ['hol_skip_cap_exceeded', 'HOL skip cap 错误码'],
  ['HOL skip', 'HOL skip 日志前缀'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: dispatcher.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('dispatcher.js HOL fix 标识全部就位 ✓');
"

echo "[hol-skip-smoke] 2. 测试文件存在并含 3 个验收用例"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/__tests__/dispatcher-hol.test.js', 'utf8');
const checks = [
  ['C1:', 'C1 验收用例'],
  ['C2:', 'C2 验收用例'],
  ['C3:', 'C3 验收用例'],
  ['hol_skip_cap_exceeded', 'C3 断言 hol_skip_cap_exceeded'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: dispatcher-hol.test.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('dispatcher-hol.test.js 3 个验收用例全部就位 ✓');
"

echo "[hol-skip-smoke] 全部检查通过 ✓"
