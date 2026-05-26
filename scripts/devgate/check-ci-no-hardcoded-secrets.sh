#!/usr/bin/env bash
# Regression lint: ci.yml 不允许明文 DB 密码
# Usage: bash scripts/devgate/check-ci-no-hardcoded-secrets.sh
set -euo pipefail

CI_FILE=".github/workflows/ci.yml"
FAIL=0

# 检查明文密码模式（仅密码字段，不检查用户名/库名）
if grep -E "^\s+(DB_PASSWORD|POSTGRES_PASSWORD):\s+\S" "$CI_FILE" | grep -v "\${{" | grep -q .; then
  echo "❌ FAIL: $CI_FILE 含硬编码 DB_PASSWORD 或 POSTGRES_PASSWORD"
  grep -En "^\s+(DB_PASSWORD|POSTGRES_PASSWORD):\s+\S" "$CI_FILE" | grep -v "\${{" | head -10
  FAIL=1
fi

# 检查 DATABASE_URL 里的明文密码（格式：://user:password@）
if grep -E "DATABASE_URL:.*://[^:]+:[^@\$]+@" "$CI_FILE" | grep -v "\${{" | grep -q .; then
  echo "❌ FAIL: $CI_FILE 含 DATABASE_URL 明文密码"
  grep -En "DATABASE_URL:.*://[^:]+:[^@\$]+@" "$CI_FILE" | grep -v "\${{" | head -10
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ ci.yml 无硬编码 DB 密码"
fi
exit "$FAIL"
