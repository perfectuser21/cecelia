#!/bin/bash
set -e
echo "=== account1-restore smoke ==="
USAGE=$(curl -sf localhost:5221/api/brain/account-usage)
echo "$USAGE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'account1' in d.get('usage',{}), 'account1 missing from pool'; assert 'account2' in d.get('usage',{}), 'account2 missing from pool'; print('✅ both accounts in pool')"
echo "=== PASS ==="
