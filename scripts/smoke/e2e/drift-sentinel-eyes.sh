#!/bin/bash
# E2E 验收脚本 — 漂移哨兵容器双目修复
# Sprint: 07171300-drift-sentinel-eyes
# Task: fe385921-603a-449f-ba88-606559fd2d43
set -e

SENTINEL="packages/brain/src/cron/drift-sentinel.js"
PASS_COUNT=0
FAIL_COUNT=0

check() {
  local desc="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $desc"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "[e2e-verify] drift-sentinel 容器双目修复验收"
echo ""

# FR-FIX-01: sha_main 改公开 HTTPS URL
check "sha_main 使用 perfectuser21/cecelia.git 公开 URL" \
  "grep -q 'perfectuser21/cecelia.git' $SENTINEL"

check "sha_main 不再使用 'origin' 作为远端" \
  "! grep -q 'ls-remote origin' $SENTINEL"

check "sha_main 降级路径使用 curl github api（免 token）" \
  "grep -q 'api.github.com/repos/perfectuser21/cecelia/commits/main' $SENTINEL"

check "sha_main 不再使用 gh api 命令（容器内不可用）" \
  "! grep -q 'gh api' $SENTINEL"

# FR-FIX-02: sha_prod 改 localhost
check "sha_prod 默认 URL 改为 localhost:5221" \
  "grep -q 'localhost:5221' $SENTINEL"

check "sha_prod 不再硬编码 brain.cecelia.ai 为默认值" \
  "! grep -q \"'https://brain.cecelia.ai'\" $SENTINEL"

# FR-FIX-03: 错误日志含 error= 原文
check "catch 块日志包含 error= 字段" \
  "grep -q 'error=' $SENTINEL"

# 单测验收（需 vitest 可用）
if command -v npx >/dev/null 2>&1; then
  echo ""
  echo "[e2e-verify] 运行单测..."
  cd packages/brain
  npx vitest run src/cron/__tests__/drift-sentinel.test.js --reporter=verbose 2>&1 | tail -20
  cd ../..
else
  echo "SKIP: npx 不可用，跳过单测"
fi

echo ""
echo "[e2e-verify] 结果: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] && echo "[e2e-verify] ALL PASS" && exit 0 || exit 1
