#!/usr/bin/env bash
# test-known-failures-expiry.sh
# 验证 check-rci-health.mjs 在缺少 expires 字段时以 exit 1 退出

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
KF_FILE="$ENGINE_DIR/ci/known-failures.json"

# 备份原文件
cp "$KF_FILE" /tmp/kf-expiry-test-bak.json

# 注入缺少 expires 的条目
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('$KF_FILE', 'utf8'));
d.allowed['test:no-expires'] = { description: 'expiry test sentinel', ticket: 'N/A' };
fs.writeFileSync('$KF_FILE', JSON.stringify(d, null, 2));
"

# 运行检查，期望 exit 1
if node "$SCRIPT_DIR/check-rci-health.mjs" --check known-failures > /dev/null 2>&1; then
  cp /tmp/kf-expiry-test-bak.json "$KF_FILE"
  echo "FAIL: 期望 exit 1，实际 exit 0（noExpiry 未被检测为错误）"
  exit 1
fi

# 恢复原文件
cp /tmp/kf-expiry-test-bak.json "$KF_FILE"
echo "PASS: noExpiry 条目被正确检测为错误（exit 1）"
exit 0
