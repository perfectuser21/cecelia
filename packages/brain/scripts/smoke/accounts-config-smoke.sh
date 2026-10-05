#!/usr/bin/env bash
set -e

# Check Claude credentials（单账号，唯一目录 ~/.claude；CI 缺失则 SKIP）
[ -f "$HOME/.claude/.credentials.json" ] && echo "OK: claude credentials exist" || echo "SKIP: claude credentials missing (CI env)"

# Verify ACCOUNTS has account1 and account2, not account3 (org disabled)
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account1" && echo "OK: account1 in ACCOUNTS" || { echo "FAIL: account1 not in ACCOUNTS"; exit 1; }
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account2" && echo "OK: account2 in ACCOUNTS" || { echo "FAIL: account2 not in ACCOUNTS"; exit 1; }
! grep "const ACCOUNTS" packages/brain/src/account-usage.js | sed "s|//.*||" | grep -q "account3" && echo "OK: account3 not in ACCOUNTS" || { echo "FAIL: account3 should not be in ACCOUNTS"; exit 1; }

echo "accounts-config smoke passed"
