#!/usr/bin/env bash
set -e

# Check account1 credentials (SKIP in CI if missing)
[ -f "$HOME/.claude-account1/.credentials.json" ] && echo "OK: account1 credentials exist" || echo "SKIP: account1 credentials missing (CI env)"

# Check account2 credentials (SKIP in CI if missing)
[ -f "$HOME/.claude-account2/.credentials.json" ] && echo "OK: account2 credentials exist" || echo "SKIP: account2 credentials missing (CI env)"

# Verify ACCOUNTS has account1 and account2, not account3 (org disabled)
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account1" && echo "OK: account1 in ACCOUNTS" || { echo "FAIL: account1 not in ACCOUNTS"; exit 1; }
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account2" && echo "OK: account2 in ACCOUNTS" || { echo "FAIL: account2 not in ACCOUNTS"; exit 1; }
! grep "const ACCOUNTS" packages/brain/src/account-usage.js | sed "s|//.*||" | grep -q "account3" && echo "OK: account3 not in ACCOUNTS" || { echo "FAIL: account3 should not be in ACCOUNTS"; exit 1; }

echo "accounts-config smoke passed"
