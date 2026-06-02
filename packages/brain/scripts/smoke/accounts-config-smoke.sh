#!/usr/bin/env bash
set -e

# 验证 account2 凭据文件（存在则 OK；CI runner 无真实凭据 → SKIP 不阻塞）
[ -f "$HOME/.claude-account2/.credentials.json" ] && echo "OK: account2 credentials exist" || echo "SKIP: account2 credentials missing（CI 环境无真实凭据，跳过非配置项）"

# 验证 account3 凭据文件（存在则 OK；CI runner 无真实凭据 → SKIP 不阻塞）
[ -f "$HOME/.claude-account3/.credentials.json" ] && echo "OK: account3 credentials exist" || echo "SKIP: account3 credentials missing（CI 环境无真实凭据，跳过非配置项）"

# 验证 ACCOUNTS 配置正确（account2+account3，不含 account1）
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account2.*account3" && echo "OK: ACCOUNTS=[account2,account3]" || { echo "FAIL: ACCOUNTS 配置不正确"; exit 1; }
! grep "const ACCOUNTS" packages/brain/src/account-usage.js | sed "s|//.*||" | grep -q "account1" && echo "OK: account1 不在 ACCOUNTS" || { echo "FAIL: account1 仍在 ACCOUNTS"; exit 1; }

echo "accounts-config smoke 全部通过"
