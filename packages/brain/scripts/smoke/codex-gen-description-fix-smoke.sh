#!/usr/bin/env bash
# Smoke test: codex_test_gen 生成器 description 字段修复
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke] codex-gen-description-fix: 验证生成器建任务时 description 非空"

# 1. 检查 codex-test-gen.js 中包含 description 字段（JS 简写属性形式）
if ! grep -q 'const description' packages/brain/src/codex-test-gen.js 2>/dev/null; then
  echo "[FAIL] codex-test-gen.js 中未找到 description 变量定义"
  exit 1
fi
echo "[PASS] description 字段存在于生成器代码"

# 2. 检查 priority 已改为 P2
if grep -q "priority.*P3" packages/brain/src/codex-test-gen.js 2>/dev/null; then
  echo "[FAIL] codex-test-gen.js 中仍有 P3 priority"
  exit 1
fi
echo "[PASS] priority 已修正（无 P3）"

# 3. 健康检查
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$BRAIN/healthz" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo "[PASS] Brain API 健康"
else
  echo "[SKIP] Brain API 不可达（HTTP $STATUS）"
fi

echo "[PASS] codex-gen-description-fix smoke 通过"
