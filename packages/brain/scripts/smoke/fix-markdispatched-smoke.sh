#!/usr/bin/env bash
# Smoke: fix-markdispatched-null-payload
# Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
# 验证 markDispatched 与通用终态写入
# 现役任务写入的 NULL payload 陷阱已修复为 COALESCE 防御写法
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

echo "=== [BEHAVIOR-4] 静态扫描：现役文件中不存在裸 NULL 陷阱写法 ==="

SCAN_RESULT=$(grep -rn 'payload = payload ||' \
  packages/brain/src/nightly-orchestrator.js \
  2>/dev/null || true)

if [ -n "$SCAN_RESULT" ]; then
  echo "FAIL: 发现裸 NULL 陷阱写法（payload = payload || ... 不含 COALESCE）："
  echo "$SCAN_RESULT"
  exit 1
fi
echo "PASS: 无裸 NULL 陷阱写法"

echo ""
echo "=== [BEHAVIOR-1] 验证 nightly-orchestrator.js markDispatched 已使用 COALESCE ==="

COALESCE_MARK=$(grep -n 'COALESCE(payload' \
  packages/brain/src/nightly-orchestrator.js 2>/dev/null || true)
if [ -z "$COALESCE_MARK" ]; then
  echo "FAIL: nightly-orchestrator.js markDispatched 未使用 COALESCE 防御写法"
  exit 1
fi
echo "PASS: $COALESCE_MARK"

echo ""
if ! grep -qF 'COALESCE(${col}, '"'"'{}'"'"'::jsonb)' packages/brain/src/lib/task-terminal.js; then
  echo "FAIL: lib/task-terminal.js 的 jsonb 合并丢了 COALESCE(col, '{}') NULL 防御"
  exit 1
fi
echo "PASS: 通用终态写入保留NULL payload防御"

echo ""
echo "=== [BEHAVIOR-5] 验证集成测试文件存在且无 pg mock ==="

INT_TEST="packages/brain/src/__tests__/nightly-orchestrator.integration.test.js"
if [ ! -f "$INT_TEST" ]; then
  echo "FAIL: 集成测试文件不存在: $INT_TEST"
  exit 1
fi
echo "PASS: 集成测试文件存在"

# 排除注释行（以 * 或 // 或 # 开头），只检查实际代码行
MOCK_COUNT=$(grep -v '^\s*[*//#]' "$INT_TEST" 2>/dev/null | grep -c 'vi\.mock.*pg\|jest\.mock.*pg' 2>/dev/null || true)
MOCK_COUNT="${MOCK_COUNT:-0}"
if [ "$MOCK_COUNT" -ne 0 ] 2>/dev/null && [ -n "$MOCK_COUNT" ] && [ "$MOCK_COUNT" != "0" ]; then
  echo "FAIL: 集成测试文件发现 pg mock（违反 INV-6）"
  exit 1
fi
echo "PASS: 集成测试文件无 pg mock（连接真实 PostgreSQL）"

echo ""
echo "=== 所有 smoke 检查通过 ==="
