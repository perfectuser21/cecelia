#!/bin/bash
set -e
echo "=== account1-restore smoke ==="

# Source check: account1 must be in ACCOUNTS (CI-safe, prevents B53 regression)
if grep -q "account1" packages/brain/src/account-usage.js; then
  echo "OK: account1 found in ACCOUNTS"
else
  echo "FAIL: account1 NOT in ACCOUNTS -- B53 regression!"
  exit 1
fi

echo "=== PASS ==="
